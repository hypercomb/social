// diamond-core-processor/src/app/home/home.component.ts

import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core'
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
import { RevisionListComponent, type RevisionRow } from '../revision-list/revision-list.component'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import { defaultHostOrigin, devDefaultBootstrap } from '../core/default-host'
import { EffectBus } from '@hypercomb/core'
import type { BatchPatchResult, PatchResult } from '../core/merkle-patch.service'
import { isCodeKind, defaultEnabled } from '../core/tree-node'
import type { BeeDocEntry, TreeNode, TreeNodeKind } from '../core/tree-node'

const DOMAINS_KEY = 'dcp.domains'

// Per-package branch-name OVERRIDE — participant-local decoration
// (localStorage), keyed by root sig. The deploy-time `label` is the
// placeholder; a typed name overrides it. Same principle as domain
// visibility: local-only, never in the lineage.
const LABEL_KEY_PREFIX = 'dcp:label:'

/** The always-first sibling: the active/logical install view — this IS the
 *  data plane (the hive), so it's labelled by the hive domain. */
const LOGICAL_VIEW_NAME = 'hypercomb.io'

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
  /** Provenance — mirrors BranchEntryLayer.kind. 'content' = adopted host
   *  content, the ONLY kind the logical (hypercomb.io) view renders.
   *  'package' = functionality (baseline install, manual domain installs,
   *  dependency records): its files show under their OWN domain group for
   *  management, but never join the logical view and never nest under a
   *  host folder. */
  kind?: 'package' | 'content'
  /** Finer-grained ZONE provenance, used only for the installer's color
   *  backgrounds (groupZone). `kind` distinguishes content vs functionality;
   *  this distinguishes WHICH functionality:
   *    'default' — the bundled baseline install (the `default` lineage: the
   *                initial Hypercomb files + own base), seeded by
   *                #seedDefaultBaseline. Always-in refs, never a manual add.
   *    'current' — tiles pushed in realtime to back up hypercomb.io (the
   *                authored/received layers). Reserved: no section feeds it
   *                yet (see #refreshReceivedLayers).
   *  Absent on a `kind: 'package'` section ⇒ a manually-installed domain
   *  (the 'package' zone). Absent on 'content' ⇒ the 'host' zone. */
  provenance?: 'default' | 'current'
  /** Placement segments the adopt landed at (mirrors BranchEntryLayer.at).
   *  Part of the section's identity: the sigbag keys branches on
   *  (name, at), so the same tile name at two locations is TWO branches —
   *  the section dedup/replace rules must compare at too. */
  at?: string[]
  /** Deploy-time branch name from the host manifest (sidecar metadata, NOT
   *  part of rootSig). Shown as the version's handle / rename placeholder. */
  label?: string
  /** Deploy timestamp (ISO) from the host manifest — orders versions
   *  chronologically so the newest is active and walkback reads in order. */
  deployedAt?: string
  /** Root sig of the version this one supersedes (the walkback chain link). */
  previous?: string | null
}

export interface DomainGroup {
  domain: string
  domainName: string
  sections: DomainSection[]
  /** The package's deploy-version chain, newest-first, offered as switchable
   *  revisions. One renders as the active section; the rest live in the
   *  revision switcher. Empty for groups with ≤1 version. */
  revisions: RevisionRow[]
  /** Root sig of the active revision (active.json pick, else newest). */
  activeRootSig: string
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TreeViewComponent, AuditorSettingsComponent, RelayPanelComponent, BeeInspectorComponent, DiamondIconComponent, PatchListComponent, RevisionListComponent, DcpCommandLineComponent, LayerEditorComponent, DcpTranslatePipe],
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

  // Reactivity trigger for per-package branch-name overrides (localStorage).
  // displayLabel() reads localStorage synchronously; this signal makes the
  // template re-render when a rename lands. Same pattern as visibility.
  readonly #labelVersion = signal(0)

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
  // Default trusted-domain suggestion. On a real host (e.g. jwize.com) this
  // is the page's own origin — the host that served you the SPA is the
  // obvious source of truth for which domain to install from. On localhost
  // (no env.js dev-host override) we fall back to the project's operator
  // host — the same self-hosted domain devDefaultBootstrap dials. Azure is
  // retired as a runtime source (domain-as-identity: operator domains are
  // the hosts). Same helper backs the relay-panel's URL default so both
  // install UIs in the top bar agree on what "this DCP instance's host" is.
  readonly defaultContentBase = defaultHostOrigin('https://jwize.com')
  readonly domains = signal<string[]>(this.#loadDomains())
  readonly domainInput = signal('')
  readonly searchTerm = signal('')
  readonly sections = signal<DomainSection[]>([])
  readonly inspectBee = signal<string | null>(null)
  readonly inspectKind = signal<TreeNodeKind>('bee')
  readonly kindFilters = signal<Set<string>>(new Set())
  readonly layersCollapsed = signal(false)
  // The active deploy revision per package domain (from active.json), keyed by
  // domainName. domainGrouped reads it to pick which version renders as the
  // active section; absent/'' ⇒ fall back to newest. Populated on load + on
  // an explicit revision switch.
  readonly #activeRootByDomain = signal<Map<string, string>>(new Map())
  // The rootSig of the package whose branch name is currently being edited
  // inline, or null when no rename input is open.
  readonly editingLabelSig = signal<string | null>(null)
  // The open rename input (only one renders at a time — the @if keys on a
  // single editingLabelSig). An effect focuses + selects it on appearance.
  readonly labelInput = viewChild<ElementRef<HTMLInputElement>>('labelInput')
  // When true, committing a rename keeps the typed name even if another
  // version under the same domain already uses it. Default (false)
  // auto-increments a colliding name with a numeric suffix. Reset per edit.
  readonly overwriteLabel = signal(false)
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

  // Live broker-walk progress for adopted branch rows — root sig → count of
  // resolved sigs (layers + resources). The walk discovers its frontier as
  // it goes, so there is no total: the row shows a climbing count over an
  // indeterminate bar. Entries linger briefly after adopt:done so the final
  // count is readable, then clear.
  readonly #adoptProgress = signal<Map<string, number>>(new Map())
  #activeAdoptRoot: string | null = null
  #adoptCueTimer: ReturnType<typeof setTimeout> | null = null

  // ── Package-update REVIEW state ──────────────────────────────────────
  // The change delta the header upgrade indicator handed us via the
  // `#upgrade=<pkg>&new=…` hash. Ephemeral + participant-local (re-derived
  // from the hash each open); never enters any lineage. `#upgradeNewSet` is
  // the set of changed signatures to surface OFF + highlighted; the rest is
  // bookkeeping so re-applies and focus don't fight each other.
  readonly #upgradeNewSet = signal<Set<string>>(new Set())
  #upgradePackageSig: string | null = null
  #upgradeScrolled = false

  // ── Feature-STAGING pre-tick ──────────────────────────────────────────
  // The hive's "show features" panel lets the participant stage features as
  // they run through tiles (benign — nothing activates). When the installer
  // opens, portal-overlay hands the staged branch sigs over via `#stage=…`.
  // We pre-TICK (enable ON, QUIET — no resync) the matching resolved nodes so
  // the wanted features are selected by default; the real fold still gates on
  // Done. Ephemeral + participant-local, re-derived from the hash each open.
  readonly #stageSet = signal<Set<string>>(new Set())

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
    const walk = (nodes: TreeNode[], adopted: boolean, isAdoptedContent: boolean) => {
      for (const n of nodes) {
        // THE ONLY THING OFF BY DEFAULT IS A FEATURE ADOPTED AT RUNTIME.
        // Everything else — the bundled baseline, manually installed packages,
        // the user's own data, the merged logical view — defaults ON. The
        // preloader unions every installed bee/dep sig and RUNS it regardless
        // of this switch (see activeSigSet), so a non-adopted switch must read
        // ON to match reality; defaulting it OFF showed the whole running
        // install as off (the "all code features are marked off" bug).
        //
        // Off-by-default is gated on the ADOPT provenance (kind === 'content',
        // set only by the runtime adopt flow), NOT on code-vs-data kind — the
        // kind default must never leak onto the baseline. Within an adopted
        // branch:
        //  - the freshly-adopted ROOT is the MASTER SWITCH: off until flipped;
        //  - its DESCENDANTS default ON (one click on the root lights the whole
        //    subtree through the effective-enabled cascade);
        //  - an un-latched adopted node falls to the kind-aware default (its
        //    DATA reads ON, its CODE OFF until enabled — where the trust gate
        //    fires).
        const inAdopted = adopted || !!n.freshlyAdopted
        // A CHANGE-DELTA item from a package update reads OFF until the
        // participant opts in — scoped to the delta only (everything else
        // keeps its normal default), so the rest of the package stays ON and
        // running. Takes precedence over the package/content default below.
        const def = n.freshlyUpgraded ? false
          : !isAdoptedContent ? true
          : adopted ? true
          : (n.freshlyAdopted ? false : defaultEnabled(n.kind))
        map.set(n.id, this.#toggleState.isEnabled(n.id, def))
        walk(n.children, inAdopted, isAdoptedContent)
      }
    }
    for (const s of this.sections()) walk(s.items, false, s.kind === 'content')
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

  /**
   * The set of signatures that ACTUALLY RUN — collapsed from every
   * effectively-ENABLED code node across ALL sections (packages included).
   * Activation is keyed by signature and happens once, so a sig referenced by
   * many features appears here once. Drives the "already active" marker: a
   * disabled script whose sig is in this set is running anyway because another
   * active feature pulls the same signature (see isActiveElsewhere).
   *
   * Walk ALL sections() rather than logicalViewItems — the latter drops
   * `kind === 'package'` sections (they don't render as tiles), but package
   * code DOES activate at runtime (the preloader unions bee/dep sigs across
   * the whole installed tree). Reads toggleMap(), so it recomputes on every
   * toggle flip exactly like the rendered switches. Lowercased on insert to
   * match the registry's sig normalization (queried lowercased too).
   */
  readonly activeSigSet = computed<Set<string>>(() => {
    const map = this.toggleMap()
    const set = new Set<string>()
    const walk = (nodes: TreeNode[], parentEnabled: boolean) => {
      for (const n of nodes) {
        // toggleMap() already encodes the adopted-aware default per node, so
        // its entry is authoritative — same source of truth as #enabledSubtree.
        const selfOn = map.get(n.id) ?? defaultEnabled(n.kind)
        const eff = parentEnabled && selfOn
        if (eff && isCodeKind(n.kind) && n.signature) set.add(n.signature.toLowerCase())
        walk(n.children ?? [], eff)
      }
    }
    for (const s of this.sections()) walk(s.items, true)
    return set
  })


  readonly domainGrouped = computed<DomainGroup[]>(() => {
    const groups = new Map<string, DomainGroup>()
    for (const s of this.filteredSections()) {
      const key = s.displayDomain
      let group = groups.get(key)
      if (!group) {
        group = { domain: s.domain, domainName: s.displayDomain, sections: [], revisions: [], activeRootSig: '' }
        groups.set(key, group)
      }
      group.sections.push(s)
    }
    const activeByDomain = this.#activeRootByDomain()
    // Versions are ordered newest-first by deploy timestamp (ISO sorts
    // chronologically); ties / missing `at` fall back to the richest tree
    // (most items) so a resolved version beats an empty import-source marker.
    // Manifest-sourced versions carry `deployedAt`; local promote-garbage does
    // not, so it naturally sinks to the bottom of the chain.
    const byRecency = (a: DomainSection, b: DomainSection): number => {
      const at = (b.deployedAt ?? '').localeCompare(a.deployedAt ?? '')
      if (at !== 0) return at
      return (b.items?.length || 0) - (a.items?.length || 0)
    }
    for (const group of groups.values()) {
      // PACKAGE sections under one domain are deploy versions of the same
      // install; exactly ONE renders (the active revision) and the chain is
      // offered through the revision switcher. CONTENT sections are adopted
      // tiles, not versions (collapsing them hid dolphin behind the jwize.com
      // manual-install section), so they always render.
      const packages = group.sections.filter(s => s.kind === 'package').sort(byRecency)
      const content = group.sections.filter(s => s.kind !== 'package')
      if (packages.length) {
        // Active revision: the active.json pick if it names one of these
        // versions, else the newest. Only the active one renders.
        const activeSig = activeByDomain.get(packages[0].domainName) || ''
        const active = packages.find(s => s.rootSig === activeSig) ?? packages[0]
        group.revisions = packages.map(s => ({ rootSig: s.rootSig, label: this.displayLabel(s), deployedAt: s.deployedAt }))
        group.activeRootSig = active.rootSig
        group.sections = [active, ...content]
      } else {
        group.revisions = []
        group.activeRootSig = ''
        group.sections = [...content]
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
      domain: '@logical', domainName: LOGICAL_VIEW_NAME, revisions: [], activeRootSig: '',
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
    // every CONTENT source sibling — adopted host content is the only
    // provenance that renders in the hive, so it's the only thing the
    // logical view mirrors. PACKAGE sections (the default baseline install,
    // manual domain installs) are functionality: their refs join the logical
    // install and their code runs, but their file trees never mount as
    // visuals — they're managed in their own domain groups (same rule the
    // hive's logical-config source applies to snapshot branches). The import
    // marker + unresolved adopt eggs contribute [] naturally.
    const sources = this.sections().filter(s => s.domain !== '@logical' && s.kind !== 'package')
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

  /** Provenance ZONE of a rendered group — drives the color background in the
   *  template (`[attr.data-zone]`). The five categories of the installer:
   *    'logical' — the live hypercomb.io merge (the @logical sibling): the
   *                effective config of everything enabled.
   *    'host'    — content adopted from a SWARM (any 'content' section; the
   *                provenance the adopt flow stamps when a participant pulls a
   *                tile from a swarm host, e.g. jwize.com → dolphin).
   *    'current' — tiles pushed in realtime to back up hypercomb.io.
   *    'default' — the bundled baseline install (the `default` lineage: the
   *                initial Hypercomb files + own base).
   *    'package' — manually-installed domains (functionality you added).
   *  Priority matters for a mixed group (one host folder can carry both a
   *  baseline package sibling and adopted content): content/swarm wins so the
   *  folder reads as a host the moment you adopt into it. */
  groupZone(group: DomainGroup): 'logical' | 'host' | 'current' | 'default' | 'package' {
    if (group.domain === '@logical') return 'logical'
    const secs = group.sections
    if (secs.some(s => s.kind === 'content')) return 'host'
    if (secs.some(s => s.provenance === 'current')) return 'current'
    if (secs.some(s => s.provenance === 'default')) return 'default'
    return 'package'
  }

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

    // When the inline rename input opens, focus it and select all text so the
    // author types over the default name (deploy-naming UX: the name is the
    // author's to set; the field offers the current handle pre-selected).
    effect(() => {
      const el = this.labelInput()?.nativeElement
      if (el) { el.focus(); el.select() }
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
    EffectBus.on<{ rootSig?: string; domains?: string[]; label?: string; at?: string[] }>('adopt:meta', (p) => {
      const branchSig = String(p?.rootSig ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(branchSig)) return

      // Placement — part of the branch identity (the sigbag keys on
      // (name, at)). The broker's own adopt:meta re-announce carries no
      // at; treat absent as root placement, same as recordInLineage.
      const at = Array.isArray(p?.at)
        ? p.at.map(s => String(s ?? '').trim()).filter(Boolean)
        : []

      // The broker's walk announces this root, then streams adopt:progress
      // (which carries no root) — remember whose walk is live so the
      // progress counts attribute to the right section row. Set BEFORE the
      // already-adopted abort below: a re-adopt re-walks the bytes (egg
      // recovery) and its row should still show resources resolving.
      this.#activeAdoptRoot = branchSig

      const domains = Array.isArray(p?.domains)
        ? p.domains.map(d => String(d ?? '').trim()).filter(Boolean)
        : []
      const sourceDomainScoped = domains[0] ? this.#prependScheme(domains[0]) : ''
      const tileName = String(p?.label ?? '').trim()

      // The signature already exists → the adopt ABORTS. A section holding
      // this branchSig (as its live rootSig, or as originalRootSig when
      // patches advanced it) means the content is already adopted — nothing
      // new to render, just reveal what's there.
      const existing = this.sections().find(s => s.rootSig === branchSig || s.originalRootSig === branchSig)
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
      // The folder is the CAPTURE-SOURCE host — "adopt from that host" files
      // the content under that host (jwize.com/dolphin), the adopted tile a
      // child node inside it. Only when the publisher advertised no domain do
      // we fall back to the importing host (the dev bootstrap), then the tile
      // name, then a sig prefix.
      const importHost = (devDefaultBootstrap()?.host || '').trim()
      const displayName = sourceHost || importHost || tileName || `branch-${branchSig.slice(0, 8)}`
      // The cue always names the tile being adopted (the child), even though
      // the folder is the host.
      const cueName = tileName || sourceHost || displayName

      const branchSection: DomainSection = {
        // The section's domain == the FOLDER HOST (https://<displayName>,
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
        // the adopt gesture imports HOST CONTENT — the only provenance the
        // logical view renders.
        kind:           'content',
        at,
      }
      // RE-ADOPT advances the pointer — the SECTION mirror of addBranch's
      // rule (dcp-domain-storage.service.ts): the same tile under the same
      // host folder AT THE SAME PLACEMENT arriving with a DIFFERENT
      // branchSig (the publisher's layer re-signed since the first adopt)
      // REPLACES the older section instead of rendering alongside it.
      // Without this, the lineage-rebuilt section (older sig) and the live
      // adopt (newer sig) both render and the tile shows twice in the
      // treeview. The sigbag keys on (name, at) — so does this: the same
      // name adopted at a DIFFERENT location is a different branch and
      // both sections render.
      const sameTile = (s: DomainSection): boolean =>
        s.kind === 'content'
        && !!branchSection.adoptLabel
        && s.adoptLabel === branchSection.adoptLabel
        && s.domainName === branchSection.domainName
        && JSON.stringify(s.at ?? []) === JSON.stringify(at)
      this.sections.update(secs => [...secs.filter(s => !sameTile(s)), branchSection])

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

    // The broker walk streams per-sig fills (layers + resources). The
    // payload's `sig` is the item just filled, not the root — attribute the
    // climbing count to the walk announced by the last adopt:meta so the
    // adopted branch's row shows resources resolving live.
    EffectBus.on<{ layers?: number; leaves?: number }>('adopt:progress', (p) => {
      const root = this.#activeAdoptRoot
      if (!root) return
      const count = (p?.layers ?? 0) + (p?.leaves ?? 0)
      this.#adoptProgress.update(m => {
        const next = new Map(m)
        next.set(root, count)
        return next
      })
    })
    EffectBus.on<{ root?: string; layers?: number; leaves?: number }>('adopt:done', (p) => {
      const root = String(p?.root ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(root)) return
      if (this.#activeAdoptRoot === root) this.#activeAdoptRoot = null
      // Let the final count linger long enough to read, then clear the cue.
      if (this.#adoptCueTimer) clearTimeout(this.#adoptCueTimer)
      this.#adoptCueTimer = setTimeout(() => {
        this.#adoptCueTimer = null
        this.#adoptProgress.update(m => {
          const next = new Map(m)
          next.delete(root)
          return next
        })
      }, 2500)
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

    // The header upgrade indicator routes here with `#upgrade=<pkg>&new=…`
    // (a package's change delta). Same hash channel as adopt; process it on
    // load and on every hash swap so re-opening the indicator re-marks.
    this.#processUpgradeHash()

    // The hive's "show features" panel routes here with `#stage=<sig,…>` —
    // wanted features' branch sigs to pre-tick ON (benign, no resync).
    this.#processStageHash()

    // Browsers do NOT reload an iframe on hash-only URL changes, so when
    // portal-overlay swaps `…#branch=A` → `…#branch=B` for a second adopt
    // the constructor doesn't re-run. Listen for hashchange too so each
    // adopt-via-iframe gets processed even on a persistent DCP instance.
    window.addEventListener('hashchange', () => { this.#processBranchHash(); this.#processUpgradeHash(); this.#processStageHash() })
  }

  /** Climbing resolved-sig count for a section's live broker walk, or null
   *  when no walk is active for it — the template's cue that the adopted
   *  row is filling. Matches originalRootSig too so a section whose root
   *  advanced (patches) still attributes its walk. */
  adoptResolvedCount(section: DomainSection): number | null {
    const m = this.#adoptProgress()
    const n = m.get(section.rootSig) ?? m.get(section.originalRootSig)
    return n === undefined ? null : n
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

      // The owner advertisement arrives in any shape (wss://host,
      // https://host, bare host). Normalize ONCE to the bare-hostname form —
      // the folder label / sigbag key — so the opened group, the rendered
      // section, and the lineage record all agree on the same name.
      const ownerHost = (() => {
        try { return ownerDomain ? new URL(this.#prependScheme(ownerDomain)).hostname.toLowerCase() : '' }
        catch { return '' }
      })()

      // Human tile name (display only — never used for resolution). Lets the
      // section header read "Adopting <name>" instead of a sig prefix.
      const tileName = (params.get('label') ?? '').trim()

      queueMicrotask(() => {
        // IMPORT mode: arriving by adopt opens the folder the content files
        // under — the capture-source host when advertised, else the importing
        // host — and focuses the adopted node inside it.
        const importHost = (ownerHost || devDefaultBootstrap()?.host || '').trim()
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
          adopt?: (sig: string, opts?: { layersOnly?: boolean }) => Promise<unknown>
          getKnownDomains?: (sig: string) => string[]
          noteDomain?: (domain: string) => void
        }
        const recordInLineage = (): void => {
          try {
            // SAVE the adopted layer's signature into the OWNER HOST's
            // sigbag — the SAME folder the section renders under (displayName,
            // e.g. jwize.com — the host the content came from).
            // Recording the ADDRESS is independent of fetching the bytes (the
            // egg model: known now, hatches when the bytes arrive) — so this
            // runs IMMEDIATELY, not gated on the broker walk succeeding (a
            // browser-published tile may have no advertised owner domain at
            // all, which is why the old getKnownDomains[0] path deferred
            // forever and nothing persisted). tileName is stored as the branch
            // entry's name so the rebuild reads the tile ("dolphin"), not the
            // layer's internal name.
            // Same precedence as the section's displayName (capture-source
            // host first), so the sigbag tile == the rendered folder.
            const owner = (ownerHost || devDefaultBootstrap()?.host || tileName || '').trim().toLowerCase()
            if (!owner) return
            // 'content' — the adopt gesture imports HOST CONTENT into the
            // hive; this is the only provenance that renders visual tiles.
            void this.#domainStorage.addDomainBranch(owner, branchSig, at, tileName || undefined, undefined, 'content')
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
            // layersOnly — DCP mirrors only the LAYER closure (markers +
            // structure), NOT the branch's resources. Resources stream on
            // demand from the publisher domain at render time. "Only broadcast
            // what is necessary": adopting a content-rich branch transfers a
            // handful of tiny layers, not its hundreds of images.
            void broker.adopt(branchSig, { layersOnly: true })
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

  /** Read `#upgrade=<packageSig>&new=<sig,sig,…>&previous=<sig>` from the URL
   *  hash — the header upgrade indicator's handoff — and stage the package
   *  update for REVIEW. The hive only ROUTED us here; this is where the
   *  participant reviews the changed items (rendered off + highlighted) and
   *  opts in. `new` is the change delta the hive computed (bundle bees absent
   *  from its install). Nothing installs or runs in the hive from here — the
   *  marks are presentation + a quiet OFF gate; only an explicit opt-in below
   *  syncs a delta bee back. */
  #processUpgradeHash(): void {
    try {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return
      const params = new URLSearchParams(hash)
      const pkg = (params.get('upgrade') ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(pkg)) return

      const newSet = new Set(
        (params.get('new') ?? '')
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(s => /^[a-f0-9]{64}$/.test(s)),
      )
      // Nothing concrete to mark without an explicit delta. (A future
      // refinement can diff against `previous` to derive the delta when the
      // explicit list was omitted for size; the hive sends it inline today.)
      if (!newSet.size) return

      this.#upgradePackageSig = pkg
      this.#upgradeScrolled = false
      this.#upgradeNewSet.set(newSet)

      // DCP resolves its OWN origin's current (i.e. the new) version on load,
      // so the changed bees land in the tree + OPFS — "successfully resolved
      // what should run" == present in a resolved section, which is what makes
      // them enable-able here. Apply now, then re-apply as that resolve
      // settles. Idempotent, so repeated application is harmless.
      this.#applyUpgradeMarks()
      setTimeout(() => this.#applyUpgradeMarks(), 600)
      setTimeout(() => this.#applyUpgradeMarks(), 2000)
    } catch { /* malformed hash → silent — the indicator can re-open */ }
  }

  /** Read `#stage=<sig,sig,…>` from the URL hash — the hive's "show features"
   *  panel's BENIGN staging hand-off. Each sig is a wanted feature's branch
   *  signature. Pre-TICK the matching resolved nodes ON so they're selected by
   *  default; nothing folds until the participant accepts (Done). Re-applied
   *  as the tree resolves (a staged branch may still be materializing),
   *  idempotent. NOTE: only ticks branches DCP has actually resolved into the
   *  tree, and matches by node signature — a content branch root is already ON
   *  by default, so the pre-tick is most meaningful once a feature's CODE
   *  signature is what gets staged (a future hive-side refinement; the channel
   *  is ready). */
  #processStageHash(): void {
    try {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return
      const params = new URLSearchParams(hash)
      const set = new Set(
        (params.get('stage') ?? '')
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(s => /^[a-f0-9]{64}$/.test(s)),
      )
      if (!set.size) return
      this.#stageSet.set(set)
      this.#applyStageMarks()
      setTimeout(() => this.#applyStageMarks(), 600)
      setTimeout(() => this.#applyStageMarks(), 2000)
    } catch { /* malformed hash → silent — the panel can re-open */ }
  }

  /** Enable (ON, QUIET — no broadcast/resync) every resolved node whose
   *  signature is in the staged set, but only when the participant has NEVER
   *  explicitly toggled it (never stomp a manual choice). Quiet so the hive
   *  stays exactly as it is until Done; the tick is purely the pre-selected
   *  checkbox state. Re-runnable as the baseline resolves. */
  #applyStageMarks(): void {
    const set = this.#stageSet()
    if (!set.size) return
    const toEnable: string[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        const sig = String(n.signature ?? '').toLowerCase()
        if (sig && set.has(sig) && this.#toggleState.stored(n.id) === undefined) {
          toEnable.push(n.id)
        }
        walk(n.children ?? [])
      }
    }
    for (const s of this.sections()) walk(s.items)
    if (toEnable.length) {
      this.#toggleState.setManyEnabledQuiet(toEnable, true)
      this.#refreshSections()
    }
  }

  /** Mark the resolved change-delta nodes `freshlyUpgraded` (off + highlighted)
   *  and hold each OFF for real via a QUIET explicit-false write — no resync,
   *  so the hive stays exactly as it is until opt-in. Never overrides an
   *  explicit participant choice: an already-enabled delta item loses the
   *  highlight (it was opted in); an item we (or the participant) already set
   *  is left untouched. Re-runnable: applied again as the baseline resolves. */
  #applyUpgradeMarks(): void {
    const newSet = this.#upgradeNewSet()
    if (!newSet.size) return
    const toDisable: string[] = []
    const foundSigs = new Set<string>()
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        const sig = String(n.signature ?? '').toLowerCase()
        const inSet = !!sig && newSet.has(sig)
        const stored = this.#toggleState.stored(n.id)
        const optedIn = stored === true
        const mark = inSet && !optedIn
        if (n.freshlyUpgraded !== mark) n.freshlyUpgraded = mark
        if (inSet) {
          foundSigs.add(sig)
          // Hold it OFF for the sync gate (sentinel keys toggles by sig ===
          // node.id) WITHOUT a broadcast — but only when never chosen, so we
          // don't stomp an opt-in or re-disable a manual enable.
          if (isCodeKind(n.kind) && stored === undefined) toDisable.push(n.id)
        }
        walk(n.children ?? [])
      }
    }
    for (const s of this.sections()) walk(s.items)
    if (toDisable.length) this.#toggleState.setManyEnabledQuiet(toDisable, false)
    this.#refreshSections()
    // Once any changed item is on screen, focus its package (once).
    if (foundSigs.size > 0 && !this.#upgradeScrolled) {
      this.#upgradeScrolled = true
      this.#focusUpgradePackage()
    }
  }

  /** Open + scroll to the package group that carries the changed items, so
   *  the participant lands on what changed. Prefers the section actually
   *  holding freshly-upgraded nodes; falls back to the bundled-default group. */
  #focusUpgradePackage(): void {
    let target: DomainSection | undefined
    let best = 0
    for (const s of this.sections()) {
      const c = this.#countUpgraded(s.items)
      if (c > best) { best = c; target = s }
    }
    if (!target) target = this.sections().find(s => s.provenance === 'default')
    if (!target) return
    this.importMode.set(false)
    this.openGroup.set(target.displayDomain || target.domainName)
    const domain = target.domain
    setTimeout(() => this.#scrollSectionIntoView(domain, true), 120)
  }

  /** Count CHANGE-DELTA items still awaiting opt-in (off + highlighted) in a
   *  node subtree — drives the per-section "N new" banner. */
  #countUpgraded(nodes: TreeNode[]): number {
    let n = 0
    const walk = (items: TreeNode[]): void => {
      for (const it of items) {
        if (it.freshlyUpgraded) n++
        walk(it.children ?? [])
      }
    }
    walk(nodes)
    return n
  }

  /** Template hook: changed-items-awaiting-opt-in count for a section. */
  upgradeCount(section: DomainSection): number {
    return this.#countUpgraded(section.items)
  }

  /** True while a package-update REVIEW is active for this group — any of its
   *  sections still carries change-delta items awaiting opt-in. Revision
   *  RESTORE (browsing older versions, switching the active root) is
   *  SUPPRESSED in this state: you finish reviewing/opting into the update
   *  first. The two are mutually exclusive — "you can restore revisions, but
   *  not during an upgrade." Restore returns the moment the delta is cleared
   *  (every changed item opted in or navigated away). */
  groupHasUpgrade(group: DomainGroup): boolean {
    return group.sections.some(s => this.#countUpgraded(s.items) > 0)
  }

  /** Opt in to ALL of this section's changed items at once: enable every
   *  freshly-upgraded node (ONE broadcast → one web resync that streams them
   *  in), clear their highlight, and drive the logical recompute + registry
   *  snapshot so the hive picks them up. The per-item path is the normal
   *  toggle; this is the bulk "accept the update" gesture. */
  async optInAllUpgrades(section: DomainSection): Promise<void> {
    const ids: string[] = []
    const collect = (items: TreeNode[]): void => {
      for (const it of items) {
        if (it.freshlyUpgraded) { ids.push(it.id); it.freshlyUpgraded = false }
        collect(it.children ?? [])
      }
    }
    collect(section.items)
    if (!ids.length) return
    this.#toggleState.setManyEnabled(ids, true)   // broadcasts → web resync streams them
    this.#refreshSections()
    void this.#domainStorage.recomputeLogical()
      .then(() => { this.#logicalVersion.update(v => v + 1); void this.#postRegistrySnapshot() })
      .catch(e => console.warn('[home] opt-in-all recompute failed', e))
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

    // Adopt = intent to use. A CONTENT-ONLY branch (no code anywhere in the
    // resolved subtree) auto-enables on arrival, so solo reflects the
    // adoption immediately — otherwise "adopted, back to solo, refresh" shows
    // nothing until the participant finds the master switch. Branches that
    // carry CODE keep the OFF default: their first enable goes through the
    // activation trust gate (#32), which auto-enable must not bypass.
    const subtreeHasCode = (n: TreeNode): boolean =>
      isCodeKind(n.kind) || (n.children ?? []).some(subtreeHasCode)
    // Explicit participant OFF is sacred — a re-resolve/refill of a branch
    // the participant deliberately disabled must NOT flip it back on. Only
    // the never-touched default qualifies for auto-enable.
    if (!subtreeHasCode(root) && this.#toggleState.stored(root.id) !== false) {
      this.#toggleState.setEnabled(root.id, true)
      void this.#domainStorage.setFeatureEnabled(branchSig, true)
        .then(() => this.#domainStorage.recomputeLogical())
        .then(() => {
          this.#logicalVersion.update(v => v + 1)
          void this.#postRegistrySnapshot()
        })
        .catch(e => console.warn('[home] auto-enable on adopt failed', e))
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

  // ─── Package Adopt / Save / Discard ─────────────────────────────────
  // The three-way lifecycle for a package (named via the version editor;
  // its versions switchable via the revision list). ADOPT = installed +
  // ENABLED (live in the logical view). SAVE = installed but OFF — a named,
  // saved revision you "change to" / enable later. DISCARD = uninstall.
  // Adopt/Save reuse the participant-local feature-enable flag; the package's
  // bytes are already local, so this is the activation decision, not a
  // re-fetch. (Package-scoped for now — generalizing to other installer
  // types is a separate, deliberate step.)

  /** 'adopted' = enabled (live), else 'saved' (installed, off). The
   *  #logicalVersion read registers the reactive dependency so the control
   *  re-renders when an enable flips. */
  packageState(section: DomainSection): 'adopted' | 'saved' {
    this.#logicalVersion()
    return this.#domainStorage.isFeatureEnabled(section.rootSig) ? 'adopted' : 'saved'
  }

  #setPackageEnabled(section: DomainSection, enabled: boolean): void {
    if (!/^[a-f0-9]{64}$/.test(section.rootSig)) return
    void this.#domainStorage.setFeatureEnabled(section.rootSig, enabled)
      .then(() => this.#domainStorage.recomputeLogical())
      .then(() => { this.#logicalVersion.update(v => v + 1); void this.#postRegistrySnapshot() })
      .catch(e => console.warn('[home] package adopt/save failed', e))
    // Tell any connected hive to resync — the next sync sig reflects the new
    // enabled set (resyncFromSentinel adds/removes the package's files).
    this.#toggleState.notifyChanged()
  }

  /** Adopt: install + enable (live in the logical view now). */
  adoptPackage(section: DomainSection): void { this.#setPackageEnabled(section, true) }

  /** Save: keep installed but OFF — a saved revision to enable / change to later. */
  savePackage(section: DomainSection): void { this.#setPackageEnabled(section, false) }

  /** Discard: uninstall the package (same removal the × performs). */
  discardPackage(section: DomainSection): void { this.removeDomain(section.domain) }


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
          // PACKAGES NEVER REBUILD AS CONTENT SECTIONS. A 'package' entry
          // (the baseline manifest install the sentinel records under the
          // install host, a cross-domain dependency record) is registry
          // provenance: its refs are in the logical union and its code runs,
          // but rendering its file tree as an adopted folder put
          // diamondcoreprocessor.com's files inside jwize.com — and filling
          // that section sprayed every package layer into the domains
          // lineage via recordTreeDeps. Package files are managed in the
          // package's OWN domain group (the baseline siblings). Legacy
          // entries pre-date `kind` — infer 'package' when the entry was
          // recorded under the domain's own name (the manifest-install
          // shape), same inference as getRegistrySnapshot.
          if ((b.kind ?? (b.name === domain.name ? 'package' : 'content')) === 'package') continue
          // The recorded tile name (e.g. "dolphin") renames the resolved root
          // so the rebuilt section reads as what was adopted, not the layer's
          // internal name. Skip a bare sig-prefix fallback (8 hex).
          const recordedName = String(b.name ?? '').trim()
          const adoptLabel = /^[a-f0-9]{8}$/.test(recordedName) ? undefined : (recordedName || undefined)
          // Idempotent — by sig (rootSig, or originalRootSig when patches
          // advanced it) AND by tile identity (host folder + tile name +
          // placement, the sigbag's (name, at) key). The identity check
          // matters because a live adopt may hold a NEWER sig than the
          // lineage entry read here (recordInLineage replaces the entry
          // asynchronously) — rebuilding from the stale sig would render
          // the same tile twice. Comparing `at` keeps two same-named
          // branches at different placements as the two sections they are.
          const entryAt = JSON.stringify(b.at ?? [])
          const dup = (list: DomainSection[]): boolean => list.some(s =>
            s.rootSig === sig || s.originalRootSig === sig
            || (s.kind === 'content' && !!adoptLabel && s.adoptLabel === adoptLabel
                && s.domainName === domain.name && JSON.stringify(s.at ?? []) === entryAt))
          if (dup(this.sections()) || dup(fresh)) continue

          // ALREADY-INSTALLED FAST PATH. A branch sig is immutable content: if
          // its layer closure is already in local OPFS (installed a prior
          // session), there is nothing to install. Resolve it from LOCAL ONLY —
          // the section opens already-filled, with NO loading bar, NO domain
          // re-fetch, and NO re-walk. Only branches absent locally (genuinely
          // new) take the fetch-with-progress path below. This is the installer
          // mirror of the hive fold's adds/removes diff: filter what's present,
          // show progress only for what's new. Re-fetching an immutable sig you
          // already hold is a no-op by definition — "if dolphin was installed
          // last time, no reason to install or log anything."
          const localRoot = await this.#resolver
            .resolveFromLocal(sig, `https://${domain.name}`)
            .catch(() => null)
          const named: TreeNode | null = localRoot
            ? { ...localRoot, name: adoptLabel || localRoot.name, expanded: true }
            : null

          fresh.push({
            domain: `https://${domain.name}`,
            domainName: domain.name,
            displayDomain: domain.name,
            rootSig: sig,
            originalRootSig: sig,
            items: named ? [named] : [],
            // installed → not loading: no progress bar for an existing branch
            loading: !named,
            error: null,
            installStatus: named ? null : 'Resolving adopted branch…',
            patches: [],
            enabled: true,
            adoptLabel,
            kind: 'content',
            at: b.at ?? [],
          })
        }
      }
      if (!fresh.length) return
      // Push-time re-check against the CURRENT sections: the live adopt:meta
      // path may have landed a section for the same sig/tile while this
      // rebuild awaited OPFS (the loop's check reads pre-await state).
      // Filtering inside the update closes that window — the race can't
      // double-render.
      let pushed: DomainSection[] = []
      this.sections.update(secs => {
        pushed = fresh.filter(f => !secs.some(s =>
          s.rootSig === f.rootSig || s.originalRootSig === f.rootSig
          || (s.kind === 'content' && !!f.adoptLabel && s.adoptLabel === f.adoptLabel
              && s.domainName === f.domainName
              && JSON.stringify(s.at ?? []) === JSON.stringify(f.at ?? []))))
        return [...secs, ...pushed]
      })
      if (!pushed.length) return
      // #77-B: seed each fresh section with the visual-context nodes (the
      // already-there items from other enabled domains + default) so the
      // single tree shows incoming features landing among what's there.
      for (const s of pushed) {
        const ctx = await this.buildVisualContext(s.domainName)
        if (ctx.length) {
          this.sections.update(secs => secs.map(sec =>
            sec.rootSig === s.rootSig ? { ...sec, items: [...sec.items, ...ctx] } : sec
          ))
        }
      }
      // "You have the signature, you have the host" — each branch's
      // recorded OWNER domain is its byte source (the capture-source host
      // the adopt filed it under). Fetch the branch from there on every
      // rebuild; local OPFS is just the cache, and an egg is only correct
      // when the host genuinely doesn't serve the bytes yet. The dev
      // bootstrap byteSource is a last resort for sections without a
      // dialable domain.
      const fallback = (devDefaultBootstrap()?.byteSource || '').trim() || undefined
      // Only fetch branches NOT already resolved from local (loading still
      // true). Installed branches were filled above — re-fetching an immutable
      // sig would be a redundant install + progress flash for nothing.
      for (const s of pushed) {
        if (!s.loading) continue
        void this.#resolveBranchSection(s.rootSig, s.domain, s.domain || fallback)
      }
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
        // packages never render — not even as dimmed context (the baseline
        // install is enabled by default, but it's functionality, not tiles)
        if ((b.kind ?? (b.name === dom.name ? 'package' : 'content')) === 'package') continue
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

  /** The participant-local rename for a package (localStorage), or '' if none.
   *  The #labelVersion() read registers the reactive dependency. */
  labelOverride(rootSig: string): string {
    this.#labelVersion()                        // reactive dependency
    if (!rootSig) return ''
    try { return localStorage.getItem(LABEL_KEY_PREFIX + rootSig) ?? '' } catch { return '' }
  }

  /** The handle shown for a version: local rename → deploy label → short sig. */
  displayLabel(section: DomainSection): string {
    return this.labelOverride(section.rootSig)
      || section.label
      || (section.rootSig ? section.rootSig.slice(0, 10) : '')
  }

  /** Persist a participant-local rename for a package. Empty clears it (falls
   *  back to the deploy label / short sig). */
  renameLabel(section: DomainSection, name: string): void {
    if (!section.rootSig) return
    const key = LABEL_KEY_PREFIX + section.rootSig
    const trimmed = (name ?? '').trim()
    try {
      if (trimmed) localStorage.setItem(key, trimmed)
      else localStorage.removeItem(key)
    } catch { /* storage unavailable — non-fatal */ }
    this.#labelVersion.update(v => v + 1)
  }

  // Set while cancelling an inline rename so the blur fired by removing the
  // input from the DOM does not re-commit the discarded text.
  #cancelLabelEdit = false

  /** Open the inline rename input for a package version. Overwrite resets to
   *  off so each edit starts from "increment if the name is taken". */
  startLabelEdit(section: DomainSection): void {
    if (!section.rootSig) return
    this.overwriteLabel.set(false)
    this.editingLabelSig.set(section.rootSig)
  }

  /** Commit an inline rename from the input element and close the editor.
   *  A non-empty name that collides with another version under the same
   *  domain auto-increments (name-2, name-3…) unless overwrite is on. */
  commitLabelEdit(section: DomainSection, event: Event): void {
    if (this.#cancelLabelEdit) { this.#cancelLabelEdit = false; return }
    const raw = ((event.target as HTMLInputElement | null)?.value ?? '').trim()
    const name = raw ? this.#uniqueLabel(section, raw, this.overwriteLabel()) : ''
    this.renameLabel(section, name)
    this.editingLabelSig.set(null)
  }

  /** Resolve a non-colliding handle for a version. Gathers the display names
   *  of the OTHER versions under the same domain (the full set, including
   *  versions collapsed behind +N); if `desired` is taken and `overwrite` is
   *  false, appends the lowest free numeric suffix. Collision is
   *  case-insensitive since handles are user-facing. */
  #uniqueLabel(section: DomainSection, desired: string, overwrite: boolean): string {
    if (overwrite) return desired
    const taken = new Set<string>()
    for (const s of this.sections()) {
      if (s.rootSig === section.rootSig) continue
      if (s.displayDomain !== section.displayDomain) continue
      const handle = this.displayLabel(s)
      if (handle) taken.add(handle.toLowerCase())
    }
    if (!taken.has(desired.toLowerCase())) return desired
    for (let i = 2; ; i++) {
      const candidate = `${desired}-${i}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  /** Toggle the overwrite flag without stealing focus from the rename input
   *  (the button uses mousedown-preventDefault so the input keeps focus and
   *  Enter still commits with the chosen flag). */
  toggleOverwrite(): void {
    this.overwriteLabel.update(v => !v)
  }

  /** Discard an in-progress rename (Escape) without committing the input. */
  cancelLabelEdit(): void {
    this.#cancelLabelEdit = true
    this.editingLabelSig.set(null)
  }

  /** Deploy timestamp formatted for display (ISO → "YYYY-MM-DD HH:mm"). */
  deployedDisplay(section: DomainSection): string {
    const at = section.deployedAt
    if (!at) return ''
    return at.replace('T', ' ').slice(0, 16)
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
    // Opting a change-delta item IN clears its "new — review" highlight (it
    // has now been reviewed + enabled), mirroring the freshly-adopted rule.
    if (node.freshlyUpgraded && nowOn) node.freshlyUpgraded = false
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

  /** Ctrl/Cmd+click on a switch — the select-all / clear-all gesture: flip
   *  the clicked node and force its ENTIRE subtree to that same explicit
   *  state (all on / all off). Explicit states are sticky (persisted per
   *  node), unlike the defaults. Turning ON runs the same activation trust
   *  gate as a normal enable when the subtree contains code. */
  async onToggleAll(node: TreeNode): Promise<void> {
    const before = this.toggleMap()
    const current = before.get(node.id) ?? defaultEnabled(node.kind)
    const next = !current

    if (next) {
      const hasCode = (n: TreeNode): boolean =>
        isCodeKind(n.kind) || (n.children ?? []).some(hasCode)
      if (hasCode(node)) {
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
              node.hatchBlocker = 'untrusted'
              this.#refreshSections()
              return
            }
            if (node.hatchBlocker === 'untrusted') node.hatchBlocker = undefined
          }
        }
      }
    }

    const ids: string[] = []
    const collect = (n: TreeNode): void => {
      ids.push(n.id)
      for (const c of (n.children ?? [])) collect(c)
    }
    collect(node)
    this.#toggleState.setManyEnabled(ids, next)
    this.#refreshSections()

    // Same branch-granularity logical drive as onToggle.
    const branchSig = this.#sectionRootSigForNode(node)
    if (/^[a-f0-9]{64}$/.test(branchSig)) {
      void this.#domainStorage.setFeatureEnabled(branchSig, next)
        .then(() => this.#domainStorage.recomputeLogical())
        .then(() => {
          this.#logicalVersion.update(v => v + 1)
          void this.#postRegistrySnapshot()
        })
        .catch(e => console.warn('[home] logical recompute on toggle-all failed', e))
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
          // 'package' — a cross-domain dependency record is functionality
          // provenance; it must never mount as visual tiles in the hive.
          await this.#domainStorage.addDomainBranch(depDomain, sig, [], node.name, undefined, 'package')
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

  /** Switch which DEPLOY revision of a package is active. The chosen version
   *  is already a resolved sibling section, so this persists the pick to
   *  active.json, points #activeRootByDomain at it (domainGrouped then renders
   *  it), resolves its tree if it was never loaded, and broadcasts so the
   *  running hive resyncs to the newly-active root. */
  async onSwitchRevision(section: DomainSection, rootSig: string): Promise<void> {
    if (!rootSig || rootSig === section.rootSig) return
    await this.#patchStore.setActiveRoot(section.domainName, rootSig)
    this.#activeRootByDomain.update(m => {
      const next = new Map(m)
      next.set(section.domainName, rootSig)
      return next
    })
    const target = this.sections().find(s =>
      s.kind === 'package' && s.domainName === section.domainName && s.rootSig === rootSig)
    if (target && !target.items.length) {
      // Never resolved (e.g. an older version that was offscreen) — load it.
      await this.#switchSectionRoot(target, rootSig)
    } else {
      this.#refreshSections()
    }
    this.#toggleState.notifyChanged()
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
      // promoted from a package source → inherits package provenance
      kind: sourceSection.kind ?? 'package',
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
    // Let #refreshFromLineage + the persisted-domains effect settle first, so
    // the idempotency check below sees any already-present default section.
    await new Promise(r => setTimeout(r, 80))

    // SOURCE-OF-TRUTH ORDER for the baseline. The installer app and its
    // default package DEPLOY TOGETHER — diamondcoreprocessor.com in
    // production, the dev server locally (copy-to-dcp stages manifest.json
    // + the flat sig dirs at the origin root) — so the canonical source is
    // DCP's OWN ORIGIN. The dev bootstrap (byteSource + pinned sig) is the
    // FALLBACK: a stale pin must never leave the baseline unresolved when
    // the origin serves current content (jwize-pinned 82dfae00 did exactly
    // that).
    const candidates: { base: string; host: string; sig: string }[] = []
    const own = (globalThis.location?.origin ?? '').replace(/\/+$/, '')
    if (own) {
      const ownSig = (await this.#resolver.fetchAllRootSignatures(own).catch(() => []))[0] ?? ''
      if (/^[a-f0-9]{64}$/.test(ownSig)) {
        candidates.push({ base: own, host: globalThis.location?.hostname || own, sig: ownSig })
      }
    }
    const cfg = devDefaultBootstrap()
    if (cfg?.byteSource) {
      const base = cfg.byteSource.replace(/\/+$/, '')
      let sig = String(cfg.sig ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(sig)) {
        sig = (await this.#resolver.fetchAllRootSignatures(base).catch(() => []))[0] ?? ''
      }
      if (/^[a-f0-9]{64}$/.test(sig)) candidates.push({ base, host: (cfg.host || base).trim(), sig })
    }
    if (!candidates.length) return

    for (const { base, host, sig } of candidates) {
      // The baseline is ALWAYS present — it shows even alongside adopted
      // sections (it's the user's starting point, not a fallback for an
      // empty dashboard). Skip only if the default's OWN PACKAGE sections
      // are already seeded (idempotency). Keyed on (domain AND kind):
      // an adopted CONTENT section can legitimately share the base domain
      // (dolphin under jwize.com), and matching on domain alone made the
      // race outcome either "baseline never seeds" or "adopt section
      // wiped" depending on who finished first.
      if (this.sections().some(s => s.domain === base && s.kind === 'package')) return
      const resolved = await this.#resolveBaselineCandidate(base, host, sig)
      if (resolved) return
    }

    // Every candidate failed — surface one error row for visibility.
    const first = candidates[0]
    this.sections.set([...this.sections(), {
      domain: first.base, domainName: first.host, displayDomain: first.host,
      rootSig: first.sig, originalRootSig: first.sig, items: [],
      loading: false, error: 'default baseline did not resolve',
      installStatus: null, patches: [], enabled: true, kind: 'package', provenance: 'default',
    }])
  }

  /** Resolve ONE baseline candidate into sections. Returns true on success;
   *  false (with its loading row removed) so the caller can try the next. */
  async #resolveBaselineCandidate(base: string, host: string, sig: string): Promise<boolean> {
    const loading: DomainSection = {
      domain: base, domainName: host, displayDomain: host,
      rootSig: sig, originalRootSig: sig, items: [],
      loading: true, error: null, installStatus: `Loading ${host} baseline…`,
      patches: [], enabled: true, kind: 'package', provenance: 'default',
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
        this.sections.set(this.sections().filter(s => s !== loading))
        return false
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
        // the baseline IS the package install — files manageable here,
        // never merged into the logical view
        kind: 'package',
        // …but it's the BUNDLED default (the `default` lineage), not a
        // manual add — its own zone color (teal) in the installer.
        provenance: 'default' as const,
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

      // keep any pre-existing (adopted) sections, drop the loading placeholder
      // and only OUR prior package output for this base — an adopted content
      // section sharing the base domain must survive the reseed — then append
      // the default's siblings; the template sorts for display.
      const others = this.sections().filter(s =>
        s !== loading && !(s.domain === base && s.kind === 'package') && s.domain !== '@logical')
      this.sections.set([...others, ...siblings])
      return true
    } catch {
      // This candidate failed — remove its loading row so the caller can
      // try the next source (own origin → dev bootstrap).
      this.sections.set(this.sections().filter(s => s !== loading))
      return false
    }
  }

  // auto-load all domains — each root signature in the manifest becomes its own section
  async #loadAllDomains(doms: string[]): Promise<void> {
    const results: DomainSection[] = []

    for (const domain of doms) {
      const domainName = new URL(domain).hostname

      // fetch all packages from the manifest — sig + sidecar branch metadata
      const packages = await this.#resolver.fetchPackages(domain)

      if (packages.length === 0) {
        // no packages found — show placeholder with error
        results.push({
          domain, domainName, displayDomain: domainName, rootSig: '', originalRootSig: '', items: [],
          loading: false, error: 'No packages found in manifest', installStatus: null, patches: [], enabled: true,
          kind: 'package'
        })
        continue
      }

      // create a section per package — manifest installs are package
      // provenance (functionality), never logical-view content. Carry the
      // deploy-time branch name + timestamp + chain link so the installer can
      // name and order the versions for walkback.
      for (const pkg of packages) {
        results.push({
          domain, domainName, displayDomain: domainName, rootSig: pkg.sig, originalRootSig: pkg.sig, items: [],
          loading: true, error: null, installStatus: null, patches: [], enabled: true,
          kind: 'package',
          label: pkg.label, deployedAt: pkg.at, previous: pkg.previous,
        })
      }
    }

    // MERGE, never clobber. Sections are produced by THREE async paths —
    // this manual/stored-domain loader, #refreshFromLineage (adopted
    // branches), and #seedDefaultBaseline — and a wholesale
    // `sections.set(results)` here erased whichever of the others had
    // already landed (the dolphin section under jwize.com appeared, then
    // vanished when this finished). Replace only OUR OWN prior output:
    // package sections for the domains being (re)loaded. Adopted content
    // sections sharing the same domain survive.
    this.sections.update(secs => [
      ...secs.filter(s => !(doms.includes(s.domain) && s.kind === 'package')),
      ...results,
    ])

    // Deploy-version sigs per domain. A revision switch sets active.json to
    // one of these; domainGrouped selects it — it must NOT be hot-swapped onto
    // every sibling section (that collapses their identities into one root).
    // Only a PATCH root (a sig that is NOT a deploy version) triggers the
    // per-section tree hot-swap below.
    const versionSigsByDomain = new Map<string, Set<string>>()
    for (const s of results) {
      if (s.kind !== 'package' || !s.rootSig) continue
      if (!versionSigsByDomain.has(s.domainName)) versionSigsByDomain.set(s.domainName, new Set())
      versionSigsByDomain.get(s.domainName)!.add(s.rootSig)
    }

    // load each section in parallel
    for (const section of results) {
      if (!section.rootSig) continue

      try {
        const root = await this.#resolver.resolveRoot(section.domain, section.rootSig, section.domainName, (p) => {
          section.installStatus = `Installing ${p.phase} ${p.current}/${p.total}`
          this.#refreshSections()
        })
        if (root) {
          section.rootSig = root.signature ?? section.rootSig
          section.originalRootSig = root.signature ?? section.originalRootSig
          const flat = this.#flattenDomainSubfolder(root.children)
          section.items = flat.items
          if (flat.displayDomain) section.displayDomain = flat.displayDomain

          // load patches and check for active root
          section.patches = await this.#patchStore.list(section.domainName)
          const activeRoot = await this.#patchStore.activeRoot(section.domainName)
          // Record the active revision so domainGrouped renders the right
          // version (and the revision switcher marks it). '' ⇒ newest wins.
          this.#activeRootByDomain.update(m => {
            const next = new Map(m)
            next.set(section.domainName, activeRoot ?? '')
            return next
          })
          const isVersion = versionSigsByDomain.get(section.domainName)?.has(activeRoot ?? '')
          if (activeRoot && activeRoot !== section.rootSig && !isVersion) {
            // hot-swap to the active PATCHED root (a non-version sig). When the
            // active root is a deploy version, leave this section alone —
            // domainGrouped picks the matching version section instead.
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
      this.#refreshSections()
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
