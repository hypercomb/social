// hypercomb-shared/ui/controls-bar/controls-bar.component.ts
// Floating contextual controls pill — minimal by default, mode-adaptive.

import {
  Component,
  computed,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  Output,
  signal,
  ViewChildren,
  type AfterViewInit,
  type OnInit,
  type OnDestroy,
  type QueryList,
} from '@angular/core'
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { Navigation } from '../../core/navigation'
import type { MovementService } from '../../core/movement.service'
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { InstallMonitor } from '../../core/install-monitor'
import { VoiceInputService } from '../../core/voice-input.service'
import { secretTag } from './secret-words'

const PILL_POS_KEY = 'hc:controls-pill-pos'
const ROW_LAYOUT_KEY = 'hc:controls-row-layout'

// ── control registry ──────────────────────────────────────

interface ControlItem {
  id: string
  icon: 'hci' | 'eye' | 'text-only' | 'mic' | 'bee'
  hci?: string
  label: string
  instruction?: string
  action: string
  visibleWhen: 'always' | 'clipboardHasItems' | 'voiceSupported' | 'public'
}

const CONTROL_REGISTRY: readonly ControlItem[] = [
  { id: 'back',         icon: 'hci',       hci: 'A', label: 'controls.back',         action: 'goBack',             visibleWhen: 'always' },
  { id: 'dcp',          icon: 'hci',       hci: '$', label: 'controls.dcp',          action: 'openDcp',            visibleWhen: 'always', instruction: 'dcp.open-processor' },
  { id: 'fit',          icon: 'hci',       hci: 'q', label: 'controls.fit-content',  action: 'fitOrCenter',        visibleWhen: 'always', instruction: 'dcp.fit-content' },
  { id: 'zoom-out',     icon: 'hci',       hci: 'I', label: 'controls.zoom-out',     action: 'zoomOut',            visibleWhen: 'always', instruction: 'dcp.zoom-out' },
  { id: 'zoom-in',      icon: 'hci',       hci: 'K', label: 'controls.zoom-in',      action: 'zoomIn',             visibleWhen: 'always', instruction: 'dcp.zoom-in' },
  { id: 'lock',         icon: 'hci',                  label: 'controls.lock',         action: 'toggleLock',         visibleWhen: 'always', instruction: 'dcp.lock' },
  { id: 'fullscreen',   icon: 'hci',       hci: "'", label: 'controls.fullscreen',   action: 'toggleFullscreen',   visibleWhen: 'always', instruction: 'dcp.fullscreen' },
  { id: 'layout',       icon: 'hci',       hci: '#', label: 'controls.layout-mode',  action: 'toggleLayout',       visibleWhen: 'always', instruction: 'dcp.layout-mode' },
  { id: 'instructions', icon: 'hci',       hci: '?', label: 'controls.instructions', action: 'toggleInstructions', visibleWhen: 'always', instruction: 'dcp.instructions-toggle' },
  { id: 'show-hidden',  icon: 'eye',                  label: 'controls.show-hidden',  action: 'toggleShowHidden',   visibleWhen: 'always' },
  { id: 'text-only',    icon: 'text-only',             label: 'controls.text-only',    action: 'toggleTextOnly',     visibleWhen: 'always' },
  { id: 'clipboard',    icon: 'hci',       hci: 'y', label: 'controls.clipboard',    action: 'openClipboard',      visibleWhen: 'clipboardHasItems' },
  { id: 'voice',        icon: 'mic',                   label: 'controls.voice',        action: 'toggleVoice',        visibleWhen: 'voiceSupported' },
  { id: 'room',         icon: 'hci',       hci: 'p', label: 'controls.location',     action: 'toggleRoom',         visibleWhen: 'public' },
  { id: 'bees',         icon: 'bee',                   label: 'controls.toggle-bees',  action: 'toggleBees',         visibleWhen: 'public' },
]

const DEFAULT_ROW_LAYOUT: Record<string, number> = {
  'back': 0, 'dcp': 0, 'fit': 0, 'zoom-out': 0, 'zoom-in': 0, 'lock': 0, 'fullscreen': 0,
  'layout': 1, 'instructions': 1, 'show-hidden': 1, 'text-only': 1,
  'clipboard': 1, 'voice': 1, 'room': 1, 'bees': 1,
}

@Component({
  selector: 'hc-controls-bar',
  standalone: true,
  imports: [TranslatePipe, CdkDrag, CdkDropList],
  templateUrl: './controls-bar.component.html',
  styleUrls: ['./controls-bar.component.scss'],
})
export class ControlsBarComponent implements OnInit, AfterViewInit, OnDestroy {

  #host = inject(ElementRef<HTMLElement>)

  // ── inputs ────────────────────────────────────────────────

  @Input() meshPublic: boolean | null = false
  @Output() meshToggled = new EventEmitter<void>()

  // ── IoC resolution ──────────────────────────────────────

  private get navigation(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }
  private get movement(): MovementService {
    return get('@hypercomb.social/MovementService') as MovementService
  }
  private get zoom(): any {
    return get('@diamondcoreprocessor.com/ZoomDrone')
  }
  private get pixiHost(): any {
    return get('@diamondcoreprocessor.com/PixiHostWorker')
  }
  private get roomStore(): RoomStore | undefined {
    return get('@hypercomb.social/RoomStore') as RoomStore | undefined
  }
  private get secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }
  private get gate(): any {
    return get('@diamondcoreprocessor.com/InputGate')
  }

  // ── reactive state ──────────────────────────────────────

  #moved$ = fromRuntime(
    get('@hypercomb.social/MovementService') as EventTarget,
    () => this.movement.moved,
  )
  #room$ = fromRuntime(
    get('@hypercomb.social/RoomStore') as EventTarget,
    () => this.roomStore?.value ?? '',
  )
  #secret$ = fromRuntime(
    get('@hypercomb.social/SecretStore') as EventTarget,
    () => this.secretStore?.value ?? '',
  )

  // ── background sync indicator ──
  private get installMonitor(): InstallMonitor | undefined {
    return get('@hypercomb.social/InstallMonitor') as InstallMonitor | undefined
  }
  readonly installState = fromRuntime(
    get('@hypercomb.social/InstallMonitor') as EventTarget,
    () => this.installMonitor?.state ?? 'idle',
  )
  readonly installChangedFiles = fromRuntime(
    get('@hypercomb.social/InstallMonitor') as EventTarget,
    () => this.installMonitor?.changedFiles ?? 0,
  )

  #idle = signal(false)
  #hovered = signal(false)
  #locked = signal(false)

  // ── power key state (ctrl / shift / alt held) ──────────
  readonly powerKey = signal<'ctrl' | 'shift' | 'alt' | null>(null)

  /** True when viewport is phone-shaped (small in either dimension). */
  readonly isMobile = signal(false)
  /** True when device is in landscape orientation AND mobile-sized. */
  readonly isLandscape = signal(false)
  /** Whether the command-line input is currently revealed on mobile. */
  readonly inputVisible = signal(false)
  #mobileQuery: MediaQueryList | null = null
  #landscapeQuery: MediaQueryList | null = null
  #mobileHandler = (e: MediaQueryListEvent) => {
    this.isMobile.set(e.matches)
    this.isLandscape.set((this.#landscapeQuery?.matches ?? false) && e.matches)
    this.#syncInputVisibility()
  }
  #landscapeHandler = (e: MediaQueryListEvent) => {
    this.isLandscape.set(e.matches && this.isMobile())
    this.#syncInputVisibility()
  }
  #syncInputVisibility = (): void => {
    // On mobile, the command-line input is hidden by default and only
    // revealed via the toggle icon. On desktop it is always visible.
    if (!this.isMobile()) {
      this.inputVisible.set(true)
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: false })
    } else {
      this.inputVisible.set(false)
      EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
    }
  }
  readonly toggleInput = (): void => {
    const next = !this.inputVisible()
    this.inputVisible.set(next)
    EffectBus.emit('mobile:input-visible', { visible: next, mobile: this.isMobile() })
  }
  readonly hideInput = (): void => {
    if (!this.isMobile() || !this.inputVisible()) return
    this.inputVisible.set(false)
    EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
  }
  #utility = signal(localStorage.getItem('hc:utility-expanded') !== 'false')
  #moveMode = signal(false)
  #mode = signal<'browsing' | 'clipboard' | 'atomize'>('browsing')
  #clipboardItems = signal<string[]>([])
  #roomValue = signal('')
  #roomOpen = signal(false)
  #beesVisible = signal(localStorage.getItem('hc:bees-visible') === 'true')
  #showHidden = signal(localStorage.getItem('hc:show-hidden') === '1')
  #fitLocked = signal(localStorage.getItem('hc:fit-locked') === '1')
  #fitLockedSnapshot: { scale: number; cx: number; cy: number; dx: number; dy: number } | null = null
  #clipboardAvailable = signal(false)
  #clipboardViewportSnapshot: { scale: number; px: number; py: number; sx: number; sy: number } | null = null
  #hasSelection = signal(false)
  #textOnly = signal(false)
  #layoutPinned = signal(false)
  #tags = signal<{ name: string; count: number }[]>([])
  #tagPanelOpen = signal(false)
  #activeTagFilters = signal<Set<string>>(new Set())
  #hoveredTags = signal<Set<string>>(new Set())
  readonly addressHover = signal(false)
  #atomizeTarget = signal('')
  #atomizeStrategy = signal('')
  #atomizeAtomCount = signal(0)

  // ── multi-row layout ──────────────────────────────────────
  #rowLayout = signal<Record<string, number>>(this.#restoreRowLayout())
  #expanded = signal(false)
  @ViewChildren(CdkDropList) dropListRefs!: QueryList<CdkDropList>

  /** Visible controls grouped by row. Row 0 is always first. Empty rows are pruned. */
  readonly controlRows = computed((): { key: number; items: ControlItem[] }[] => {
    const layout = this.#rowLayout()
    // filter to visible controls
    const visible = CONTROL_REGISTRY.filter(ctrl => this.#isControlVisible(ctrl))
    // group by row
    const rowMap = new Map<number, ControlItem[]>()
    for (const ctrl of visible) {
      const row = layout[ctrl.id] ?? 0
      if (!rowMap.has(row)) rowMap.set(row, [])
      rowMap.get(row)!.push(ctrl)
    }
    // sort by row key, preserve original keys for drop handler
    return [...rowMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, items]) => ({ key, items }))
  })

  readonly toggleExpanded = (): void => {
    this.#expanded.update(v => !v)
  }
  readonly expanded = this.#expanded.asReadonly()

  readonly onControlDrop = (event: CdkDragDrop<ControlItem[]>): void => {
    const ctrl = event.item.data as ControlItem
    const targetRowKey = parseInt(
      (event.container.element.nativeElement as HTMLElement).dataset['rowKey'] ?? '0', 10,
    )
    this.#rowLayout.update(l => ({ ...l, [ctrl.id]: targetRowKey }))
    this.#persistRowLayout()
  }

  /** Action dispatch map — routes control actions to existing methods. */
  readonly #actions: Record<string, (e?: MouseEvent) => void> = {
    goBack: () => this.goBack(),
    openDcp: () => this.openDcp(),
    fitOrCenter: (e) => this.fitOrCenter(e!),
    zoomOut: () => this.zoomOut(),
    zoomIn: () => this.zoomIn(),
    toggleLock: () => this.toggleLock(),
    toggleFullscreen: () => this.toggleFullscreen(),
    toggleLayout: () => this.toggleLayout(),
    toggleInstructions: (e) => this.toggleInstructions(e!),
    toggleShowHidden: () => this.toggleShowHidden(),
    toggleTextOnly: () => this.toggleTextOnly(),
    openClipboard: () => this.openClipboard(),
    toggleVoice: () => this.toggleVoice(),
    toggleRoom: () => this.toggleRoom(),
    toggleBees: () => this.toggleBees(),
  }

  readonly runAction = (action: string, event: MouseEvent): void => {
    this.#actions[action]?.(event)
  }

  readonly isActive = (ctrl: ControlItem): boolean => {
    switch (ctrl.id) {
      case 'lock': return this.#locked()
      case 'fit': return this.#fitLocked()
      case 'layout': return this.#layoutPinned()
      case 'show-hidden': return this.#showHidden()
      case 'text-only': return this.#textOnly()
      case 'room': return this.#roomOpen()
      case 'bees': return this.#beesVisible()
      case 'voice': return this.voiceActive()
      default: return false
    }
  }

  readonly iconText = (ctrl: ControlItem): string => {
    if (ctrl.id === 'lock') return this.#locked() ? 'a' : 'b'
    return ctrl.hci ?? ''
  }

  readonly badgeValue = (ctrl: ControlItem): number => {
    if (ctrl.id === 'clipboard') return this.clipboardCount()
    return 0
  }

  /** Get the list of CdkDropList refs for cross-list connection. */
  readonly getDropLists = (): CdkDropList[] => {
    return this.dropListRefs?.toArray() ?? []
  }

  #isControlVisible(ctrl: ControlItem): boolean {
    switch (ctrl.visibleWhen) {
      case 'always': return true
      case 'clipboardHasItems': return this.#clipboardAvailable() && this.clipboardCount() > 0
      case 'voiceSupported': return this.voiceSupported
      case 'public': return !!this.meshPublic
      default: return true
    }
  }

  #restoreRowLayout(): Record<string, number> {
    try {
      const raw = localStorage.getItem(ROW_LAYOUT_KEY)
      if (!raw) return { ...DEFAULT_ROW_LAYOUT }
      const parsed = JSON.parse(raw) as Record<string, number>
      if (typeof parsed === 'object' && parsed !== null) {
        // merge with defaults so new controls get a row
        return { ...DEFAULT_ROW_LAYOUT, ...parsed }
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_ROW_LAYOUT }
  }

  #persistRowLayout(): void {
    try {
      localStorage.setItem(ROW_LAYOUT_KEY, JSON.stringify(this.#rowLayout()))
    } catch { /* ignore */ }
  }

  // ── pill zoom (scales with viewport width) ────────────────
  // Baseline 1.0 at 1920px wide (half the previous fixed 2× size).
  // Scales up linearly on larger monitors; clamped on small/huge screens.
  // Mobile uses a separate floating-icon layout that ignores this zoom.
  readonly #pillZoom = signal(this.#computePillZoom())
  readonly pillZoom = this.#pillZoom.asReadonly()

  #computePillZoom(): number {
    const ratio = window.innerWidth / 1920
    return Math.max(0.9, Math.min(ratio, 1.6))
  }

  // ── pill position (drag-to-move; no resize) ───────────────
  // null = use default CSS positioning (bottom-center). Once dragged,
  // we switch to explicit left/top and persist across sessions.
  readonly #pillPos = signal<{ x: number; y: number } | null>(null)
  readonly pillPos = this.#pillPos.asReadonly()
  readonly #pillDragging = signal(false)
  readonly pillDragging = this.#pillDragging.asReadonly()
  #pillDragOffsetX = 0
  #pillDragOffsetY = 0
  #pillPointerId: number | null = null
  #pillStageEl: HTMLElement | null = null

  #viewportCenter = (): { x: number; y: number } => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  })

  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #moveModeUnsub: (() => void) | null = null
  #touchDraggingUnsub: (() => void) | null = null
  #touchDragging = signal(false)
  #viewActiveUnsub: (() => void) | null = null
  #viewActive = signal(false)
  readonly #IDLE_DELAY = 3000

  // ── swipe-to-go-back gesture ────────────────────────────
  #swipeStartX = 0
  #swipeStartY = 0
  #swipeActive = false
  readonly #SWIPE_THRESHOLD = 80     // px to trigger back
  readonly #SWIPE_EDGE_ZONE = 40     // px from right edge to start
  readonly #SWIPE_ANGLE_MAX = 30     // max degrees from horizontal
  readonly swipeIndicatorActive = signal(false)

  // ── computed ────────────────────────────────────────────

  readonly spaceName = computed(() => {
    this.#moved$()
    return this.#room$()
  })

  /** Each segment of the lineage path, with the slice needed to navigate there. */
  readonly pathSegments = computed(() => {
    this.#moved$()
    const segs = this.navigation.segmentsRaw()
    return segs.map((name, i) => ({
      name,
      /** all segments up to and including this one */
      target: segs.slice(0, i + 1),
      /** true for the last (leaf) segment */
      leaf: i === segs.length - 1,
    }))
  })

  readonly midPath = computed(() => {
    const segs = this.pathSegments()
    if (segs.length <= 1) return ''
    return segs.slice(0, -1).map(s => s.name).join(' / ')
  })

  readonly leafSegment = computed(() => {
    const segs = this.pathSegments()
    return segs.length > 0 ? segs[segs.length - 1].name : ''
  })

  readonly prefixPath = computed(() => {
    const parts: string[] = []
    const space = this.spaceName()
    if (space) parts.push(space)
    const mid = this.midPath()
    if (mid) parts.push(mid)
    const leaf = this.leafSegment()
    if (leaf) parts.push(leaf)
    return parts.join(' / ')
  })

  readonly secretWords = computed(() => {
    const secret = this.#secret$()
    return secret ? secretTag(secret) : ''
  })

  readonly shieldColor = computed(() => {
    const secret = this.#secret$().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.35)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as { evaluate: (s: string) => number } | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(160 + score * 30)
    return `hsl(${hue}, 65%, 50%)`
  })

  readonly hasPrefixPath = computed(() => this.prefixPath().length > 0)

  /** Active domain for breadcrumb display */
  readonly activeDomain = computed(() => {
    return window.location.hostname || 'hypercomb.io'
  })

  /** Full FQDN key: space/domain/lineage/secret/cell */
  readonly #fqdn = computed(() => {
    this.#moved$()
    const space = this.#room$()
    const domain = window.location.hostname || 'hypercomb.io'
    const lineagePath = this.navigation.segmentsRaw().join('/')
    const secret = this.#secret$()
    const parts = [space, domain, lineagePath, secret, 'cell'].filter(Boolean)
    return parts.join('/')
  })

  /** SHA-256 mesh signature of the FQDN */
  readonly signedAddress = signal('')

  readonly canGoBack = computed(() => {
    this.#moved$()
    return this.navigation.segmentsRaw().length > 0
  })

  readonly locked = this.#locked.asReadonly()
  readonly fitLocked = this.#fitLocked.asReadonly()
  readonly mode = this.#mode.asReadonly()
  readonly utility = this.#utility.asReadonly()
  readonly clipboardItems = this.#clipboardItems.asReadonly()
  readonly clipboardCount = computed(() => this.#clipboardItems().length)
  readonly clipboardAvailable = this.#clipboardAvailable.asReadonly()
  readonly moveMode = this.#moveMode.asReadonly()
  readonly hasSelection = this.#hasSelection.asReadonly()
  readonly textOnly = this.#textOnly.asReadonly()
  readonly layoutPinned = this.#layoutPinned.asReadonly()
  readonly tags = this.#tags.asReadonly()
  readonly tagPanelOpen = this.#tagPanelOpen.asReadonly()

  /** Global tags not present on the current page. */
  readonly globalOnlyTags = computed(() => {
    const pageTagNames = new Set(this.#tags().map(t => t.name))
    const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
    const allNames = registry?.names ?? []
    return allNames
      .filter(n => !pageTagNames.has(n))
      .sort((a, b) => a.localeCompare(b))
  })

  readonly toggleTagPanel = (): void => {
    this.#tagPanelOpen.update(v => !v)
  }

  readonly isTagFilterActive = (name: string): boolean => {
    return this.#activeTagFilters().has(name)
  }

  readonly toggleTagFilter = (name: string): void => {
    this.#activeTagFilters.update(set => {
      const next = new Set(set)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      // Emit filter to ShowHoneycombWorker
      EffectBus.emit('tags:filter', { active: [...next] })
      return next
    })
  }

  readonly isTagHovered = (name: string): boolean => {
    return this.#hoveredTags().has(name)
  }

  readonly tagColor = (name: string): string => {
    const registry = get('@hypercomb.social/TagRegistry') as { color: (n: string) => string } | undefined
    const color = registry?.color(name)
    if (color) return color
    // fallback to localStorage for first render before registry loads
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    // deterministic vibrant color from tag name — no grays
    return tagNameToColor(name)
  }
  readonly visible = computed(() => !this.#touchDragging() && !this.#viewActive())
  readonly roomValue = this.#roomValue.asReadonly()
  readonly roomOpen = this.#roomOpen.asReadonly()
  readonly beesVisible = this.#beesVisible.asReadonly()
  readonly showHidden = this.#showHidden.asReadonly()
  readonly voiceActive = signal(false)
  readonly voiceSupported = VoiceInputService.supported()
  readonly atomizeTarget = this.#atomizeTarget.asReadonly()
  readonly atomizeStrategy = this.#atomizeStrategy.asReadonly()
  readonly atomizeAtomCount = this.#atomizeAtomCount.asReadonly()

  // ── lifecycle ───────────────────────────────────────────

  #fitLockedUnsub: (() => void) | null = null
  #clipboardUnsub: (() => void) | null = null
  #selectionUnsub: (() => void) | null = null
  #layoutModeUnsub: (() => void) | null = null
  #beesUnsub: (() => void) | null = null
  #tagsUnsub: (() => void) | null = null
  #hoverTagsUnsub: (() => void) | null = null
  #voiceActiveUnsub: (() => void) | null = null
  #showHiddenUnsub: (() => void) | null = null
  #textOnlyUnsub: (() => void) | null = null
  #clipboardAvailableUnsub: (() => void) | null = null
  #atomizeModeUnsub: (() => void) | null = null
  #atomizeAtomsUnsub: (() => void) | null = null
  #atomizeStrategyUnsub: (() => void) | null = null

  ngOnInit(): void {
    // ── mobile detection via matchMedia ──
    // Only actual smartphones (viewport ≤599px wide) collapse the command
    // line and show the mobile floating-icon strip. Anything larger —
    // tablets, laptops, desktops, and phones rotated to landscape (≥600px
    // wide) — gets the full desktop shell with the command line docked at
    // the top of the screen.
    this.#mobileQuery = window.matchMedia('(max-width: 599px)')
    this.isMobile.set(this.#mobileQuery.matches)
    this.#mobileQuery.addEventListener('change', this.#mobileHandler)

    this.#landscapeQuery = window.matchMedia('(orientation: landscape)')
    this.isLandscape.set(this.#landscapeQuery.matches && this.isMobile())
    this.#landscapeQuery.addEventListener('change', this.#landscapeHandler)

    this.#syncInputVisibility()

    // pre-fill room from store
    const stored = this.roomStore?.value ?? ''
    if (stored) this.#roomValue.set(stored)

    this.#restorePillPos()

    window.addEventListener('resize', this.#onResize)
    window.addEventListener('pointermove', this.#onActivity)
    window.addEventListener('pointerdown', this.#onActivity)
    window.addEventListener('keydown', this.#onActivity)
    window.addEventListener('navigate', this.#onActivity)
    this.#resetIdleTimer()

    // power key tracking
    window.addEventListener('keydown', this.#onPowerKeyDown)
    window.addEventListener('keyup', this.#onPowerKeyUp)
    window.addEventListener('blur', this.#onPowerKeyReset)

    // swipe-to-go-back gesture (mobile only, passive for scroll perf)
    window.addEventListener('touchstart', this.#onSwipeStart, { passive: true })
    window.addEventListener('touchmove', this.#onSwipeMove, { passive: true })
    window.addEventListener('touchend', this.#onSwipeEnd, { passive: true })

    this.#clipboardAvailableUnsub = EffectBus.on<{ available: boolean }>('clipboard:available', (payload) => {
      const available = payload?.available ?? false
      this.#clipboardAvailable.set(available)
      if (!available && this.#mode() === 'clipboard') {
        this.closeClipboard()
      }
    })

    this.#selectionUnsub = EffectBus.on<{ selected?: string[] }>('selection:changed', (payload) => {
      this.#hasSelection.set((payload?.selected?.length ?? 0) > 0)
    })

    this.#clipboardUnsub = EffectBus.on<{ items?: { label: string }[] }>('clipboard:changed', (payload) => {
      const items = payload?.items ?? []
      this.#clipboardItems.set(items.map(item => item.label))
      if (items.length === 0 && this.#mode() === 'clipboard') {
        this.closeClipboard()
      }
    })

    this.#moveModeUnsub = EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.#moveMode.set(active)
    })

    this.#beesUnsub = EffectBus.on<{ visible: boolean }>('render:set-bees-visible', ({ visible }) => {
      this.#beesVisible.set(visible)
    })

    // sync layout mode from localStorage (read current location's mode)
    const locationKey = String(this.navigation.segmentsRaw().join('/') || '/')
    this.#layoutPinned.set(localStorage.getItem(`hc:layout-mode:${locationKey}`) === 'pinned')

    this.#layoutModeUnsub = EffectBus.on<{ mode: string }>('layout:mode', ({ mode }) => {
      this.#layoutPinned.set(mode === 'pinned')
    })

    this.#touchDraggingUnsub = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      this.#touchDragging.set(active)
    })

    this.#viewActiveUnsub = EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.#viewActive.set(active)
    })

    this.#tagsUnsub = EffectBus.on<{ tags: { name: string; count: number }[] }>('render:tags', ({ tags }) => {
      // sort by hue so tags form a rainbow gradient
      const sorted = [...tags].sort((a, b) => extractHue(this.tagColor(a.name)) - extractHue(this.tagColor(b.name)))
      this.#tags.set(sorted)
    })

    this.#hoverTagsUnsub = EffectBus.on<{ tags: string[] }>('tile:hover-tags', ({ tags }) => {
      this.#hoveredTags.set(new Set(tags))
    })

    this.#voiceActiveUnsub = EffectBus.on<{ active: boolean }>('voice:active', ({ active }) => {
      this.voiceActive.set(active)
    })

    this.#showHiddenUnsub = EffectBus.on<{ active: boolean }>('visibility:show-hidden', ({ active }) => {
      this.#showHidden.set(active)
    })

    this.#textOnlyUnsub = EffectBus.on<{ textOnly: boolean }>('render:set-text-only', ({ textOnly }) => {
      this.#textOnly.set(textOnly)
    })

    this.#atomizeModeUnsub = EffectBus.on<{ active: boolean; target: string; strategy: string }>(
      'atomize:mode',
      ({ active, target, strategy }) => {
        if (active) {
          this.#mode.set('atomize')
          this.#atomizeTarget.set(target)
          this.#atomizeStrategy.set(strategy)
        } else {
          this.#mode.set('browsing')
          this.#atomizeTarget.set('')
          this.#atomizeStrategy.set('')
          this.#atomizeAtomCount.set(0)
        }
      },
    )

    this.#atomizeAtomsUnsub = EffectBus.on<{ atoms: unknown[]; target: string }>(
      'atomize:atoms',
      ({ atoms }) => {
        this.#atomizeAtomCount.set(atoms.length)
      },
    )

    this.#atomizeStrategyUnsub = EffectBus.on<{ strategy: string }>(
      'atomize:strategy-changed',
      ({ strategy }) => {
        this.#atomizeStrategy.set(strategy)
      },
    )

    // emit initial show-hidden state so drones pick it up
    if (this.#showHidden()) {
      EffectBus.emit('visibility:show-hidden', { active: true })
    }

    // fit-locked: auto fit-to-screen on every navigation
    if (this.#fitLocked()) {
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      vp?.suspend?.()
      this.#enableFitLocked()
    }

    // sign address reactively (replaces effect() which needs injection context)
    this.#recomputeAddress()
    window.addEventListener('synchronize', this.#recomputeAddress)

  }

  #recomputeAddress = (): void => {
    const key = this.#fqdn()
    SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)
      .then(sig => this.signedAddress.set(sig))
  }

  ngAfterViewInit(): void {
    // Cache the stage element now that it is in the DOM, and re-clamp
    // any position restored from localStorage against the actual pill
    // size. Guarantees the pill is always fully on-screen even if the
    // viewport shrank since the last session.
    this.#pillStageEl = this.#host.nativeElement.querySelector('.pill-stage')
    const pos = this.#pillPos()
    if (pos) this.#pillPos.set(this.#clampPillPos(pos.x, pos.y))
  }

  ngOnDestroy(): void {
    this.#mobileQuery?.removeEventListener('change', this.#mobileHandler)
    this.#landscapeQuery?.removeEventListener('change', this.#landscapeHandler)
    window.removeEventListener('resize', this.#onResize)
    window.removeEventListener('pointermove', this.#onActivity)
    window.removeEventListener('pointerdown', this.#onActivity)
    window.removeEventListener('keydown', this.#onActivity)
    window.removeEventListener('navigate', this.#onActivity)
    window.removeEventListener('touchstart', this.#onSwipeStart)
    window.removeEventListener('touchmove', this.#onSwipeMove)
    window.removeEventListener('touchend', this.#onSwipeEnd)
    window.removeEventListener('pointermove', this.#onPillDragMove)
    window.removeEventListener('pointerup', this.#onPillDragEnd)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#fitLockedUnsub?.()
    this.#clipboardUnsub?.()
    this.#selectionUnsub?.()
    this.#moveModeUnsub?.()
    this.#layoutModeUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#viewActiveUnsub?.()
    this.#beesUnsub?.()
    this.#voiceActiveUnsub?.()
    this.#showHiddenUnsub?.()
    this.#textOnlyUnsub?.()
    this.#clipboardAvailableUnsub?.()
    this.#tagsUnsub?.()
    this.#hoverTagsUnsub?.()
    this.#atomizeModeUnsub?.()
    this.#atomizeAtomsUnsub?.()
    this.#atomizeStrategyUnsub?.()
    window.removeEventListener('keydown', this.#onPowerKeyDown)
    window.removeEventListener('keyup', this.#onPowerKeyUp)
    window.removeEventListener('blur', this.#onPowerKeyReset)
    window.removeEventListener('synchronize', this.#recomputeAddress)
  }

  // ── navigation actions ────────────────────────────────

  readonly goBack = (): void => {
    performance.mark('hypercomb:back:trigger')
    void this.movement.back()
  }

  // Mobile back button fires on pointerdown to save the press duration (~50–150ms)
  // over waiting for the synthesized click. `#backHandledOnDown` swallows the
  // click that would otherwise double-back. Desktop keeps `(click)` because its
  // back button is a cdkDrag target — firing early would race with the drag.
  #backHandledOnDown = false

  readonly onBackPointerDown = (event: PointerEvent): void => {
    if (!this.canGoBack()) return
    if (event.button !== undefined && event.button !== 0) return
    this.#backHandledOnDown = true
    this.goBack()
  }

  readonly onBackClick = (): void => {
    if (this.#backHandledOnDown) {
      this.#backHandledOnDown = false
      return
    }
    this.goBack()
  }

  readonly navigateTo = (segments: string[]): void => {
    this.navigation.goRaw(segments)
  }

  // ── view actions ──────────────────────────────────────

  readonly openDcp = (): void => {
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }

  readonly centerView = (): void => {
    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return

    // bounding box of all content in container's local space
    const bounds = container.getLocalBounds()
    const cx = bounds.x + bounds.width * 0.5
    const cy = bounds.y + bounds.height * 0.5

    // offset container so content center sits at stage origin
    const scale = container.scale?.x ?? 1
    container.position.set(-cx * scale, -cy * scale)

    // reset stage pan to screen center
    const s = app.renderer.screen
    app.stage.position.set(s.width * 0.5, s.height * 0.5)

    // persist viewport state
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(scale, container.position.x, container.position.y)
    vp?.setPan?.(0, 0)
  }

  readonly fitOrCenter = (event: MouseEvent): void => {
    if (this.#fitLocked()) {
      // any click turns off fit-lock once active
      this.#toggleFitLocked()
    } else if (event.ctrlKey || event.metaKey) {
      this.#toggleFitLocked()
    } else {
      this.zoom?.zoomToFit?.()
    }
  }

  readonly fitContent = (): void => {
    this.zoom?.zoomToFit?.()
  }

  #toggleFitLocked(): void {
    const next = !this.#fitLocked()
    this.#fitLocked.set(next)
    localStorage.setItem('hc:fit-locked', next ? '1' : '0')
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    if (next) {
      // snapshot current viewport so we can restore on unlock
      this.#fitLockedSnapshot = this.#captureViewport()
      // suspend persistence so per-layer saved positions aren't overwritten
      vp?.suspend?.()
      this.zoom?.zoomToFit?.()
      this.#enableFitLocked()
    } else {
      this.#fitLockedUnsub?.()
      this.#fitLockedUnsub = null
      vp?.resume?.()
      this.#restoreViewport()
    }
  }

  #enableFitLocked(): void {
    this.#fitLockedUnsub?.()
    // navigation:guard-end fires after all tiles are positioned and layer is visible
    const unsub = EffectBus.on('navigation:guard-end', () => {
      this.zoom?.zoomToFit?.(true)
    })
    this.#fitLockedUnsub = unsub
  }

  #captureViewport(): { scale: number; cx: number; cy: number; dx: number; dy: number } | null {
    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return null
    const s = app.renderer.screen
    return {
      scale: container.scale?.x ?? 1,
      cx: container.position.x,
      cy: container.position.y,
      dx: app.stage.position.x - s.width * 0.5,
      dy: app.stage.position.y - s.height * 0.5,
    }
  }

  #restoreViewport(): void {
    const snap = this.#fitLockedSnapshot
    if (!snap) return
    this.#fitLockedSnapshot = null

    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return

    const s = app.renderer.screen
    container.scale.set(snap.scale)
    container.position.set(snap.cx, snap.cy)
    app.stage.position.set(s.width * 0.5 + snap.dx, s.height * 0.5 + snap.dy)

    // persist restored state
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(snap.scale, snap.cx, snap.cy)
    vp?.setPan?.(snap.dx, snap.dy)
  }

  readonly toggleLock = (): void => {
    this.#locked.update(v => !v)
    if (this.#locked()) {
      this.gate?.lock()
    } else {
      this.gate?.unlock()
    }
  }

  readonly zoomIn = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(1.25, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly zoomOut = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(0.8, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly toggleInstructions = (event: MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      EffectBus.emit('instruction:catalog', undefined)
    } else {
      EffectBus.emit('instruction:toggle', undefined)
    }
  }

  readonly toggleFullscreen = (): void => {
    // Capture how far the pill sits from the viewport bottom so we can
    // preserve that distance after the viewport height changes.
    const pos = this.#pillPos()
    const bottomGap = pos ? window.innerHeight - pos.y : null

    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }

    // After the viewport settles, slide the pill to the same distance
    // from the new bottom edge — no visible jump.
    if (bottomGap !== null) {
      const adjust = (): void => {
        document.removeEventListener('fullscreenchange', adjust)
        const adjusted = this.#clampPillPos(pos!.x, window.innerHeight - bottomGap)
        this.#pillPos.set(adjusted)
        try { localStorage.setItem(PILL_POS_KEY, JSON.stringify(adjusted)) } catch { /* ignore */ }
      }
      document.addEventListener('fullscreenchange', adjust)
    }
  }

  /** Mobile center-button double-click: lock fit-to-window. */
  readonly lockFit = (): void => {
    if (!this.#fitLocked()) {
      this.#toggleFitLocked()
    }
  }

  // ── push-to-talk (mobile mic button) ─────────────────────

  private get voiceService(): VoiceInputService | undefined {
    return get('@hypercomb.social/VoiceInputService') as VoiceInputService | undefined
  }

  /** Pointerdown on mic: start recording. */
  readonly startVoice = (event: PointerEvent): void => {
    ;(event.target as HTMLElement)?.setPointerCapture?.(event.pointerId)
    this.voiceService?.start()
  }

  /** Pointerup/leave on mic: stop. VoiceInputService emits voice:submit
   * which the command-line listens for and turns into a tile. */
  readonly stopVoice = (): void => {
    this.voiceService?.stop()
  }

  // ── utility actions (emit effects for drones) ─────────

  readonly cut = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copy = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
  }

  readonly remove = (): void => {
    EffectBus.emit('controls:action', { action: 'remove' })
  }

  readonly moveItem = (): void => {
    EffectBus.emit('controls:action', { action: 'move' })
  }

  readonly toggleTextOnly = (): void => {
    const next = !this.#textOnly()
    this.#textOnly.set(next)
    EffectBus.emit('render:set-text-only', { textOnly: next })
  }

  readonly toggleLayout = (): void => {
    this.#layoutPinned.update(v => !v)
    EffectBus.emit('layout:mode', { mode: this.#layoutPinned() ? 'pinned' : 'dense' })
  }

  readonly toggleMeshPublic = (): void => {
    this.meshToggled.emit()
  }

  readonly openClipboard = (): void => {
    if (!this.#clipboardAvailable()) return

    // save current viewport so we can restore it when exiting clipboard mode
    const container = this.pixiHost?.container
    const app = this.pixiHost?.app
    if (container && app) {
      this.#clipboardViewportSnapshot = {
        scale: container.scale?.x ?? 1,
        px: container.position?.x ?? 0,
        py: container.position?.y ?? 0,
        sx: app.stage.position?.x ?? 0,
        sy: app.stage.position?.y ?? 0,
      }
    }

    this.#mode.set('clipboard')
    const clipSvc = get('@diamondcoreprocessor.com/ClipboardService') as
      { items?: { label: string; sourceSegments: readonly string[] }[] } | undefined
    const items = clipSvc?.items ?? []
    EffectBus.emit('clipboard:view', {
      active: true,
      labels: items.map(i => i.label),
      sourceSegments: [...(items[0]?.sourceSegments ?? [])],
    })

    // fit-to-center after render completes (geometry must exist for bounds)
    const unsub = EffectBus.on('render:cell-count', () => {
      unsub()
      requestAnimationFrame(() => this.zoom?.zoomToFit?.())
    })
    // fallback if render:cell-count never fires (empty clipboard)
    setTimeout(() => { unsub(); this.zoom?.zoomToFit?.() }, 500)
  }

  readonly closeClipboard = (): void => {
    this.#mode.set('browsing')
    EffectBus.emit('clipboard:view', { active: false })
    this.#restoreClipboardViewport()
  }

  readonly place = (): void => {
    EffectBus.emit('controls:action', { action: 'place' })
  }

  readonly paste = (): void => {
    EffectBus.emit('clipboard:view', { active: false })
    this.#mode.set('browsing')
    this.#restoreClipboardViewport()
    EffectBus.emit('controls:action', { action: 'paste' })
  }

  readonly clearClipboard = (): void => {
    EffectBus.emit('controls:action', { action: 'clear-clipboard' })
    EffectBus.emit('clipboard:view', { active: false })
    this.#mode.set('browsing')
    this.#restoreClipboardViewport()
  }

  #restoreClipboardViewport(): void {
    const snap = this.#clipboardViewportSnapshot
    if (!snap) return
    this.#clipboardViewportSnapshot = null

    const container = this.pixiHost?.container
    const app = this.pixiHost?.app
    if (!container || !app) return

    container.scale.set(snap.scale)
    container.position.set(snap.px, snap.py)
    app.stage.position.set(snap.sx, snap.sy)

    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(snap.scale, snap.px, snap.py)
  }

  // ── atomize ──────────────────────────────────────────

  readonly STRATEGY_NAMES = ['shatter', 'orbital', 'blueprint', 'cascade', 'particle'] as const

  readonly setAtomizeStrategy = (strategy: string): void => {
    EffectBus.emit('atomize:set-strategy', { strategy })
  }

  readonly closeAtomize = (): void => {
    EffectBus.emit('atomize:close', {})
    this.#mode.set('browsing')
  }

  readonly reassemble = (): void => {
    this.closeAtomize()
  }

  // ── bees ────────────────────────────────────────────

  readonly toggleBees = (): void => {
    const next = !this.#beesVisible()
    this.#beesVisible.set(next)
    localStorage.setItem('hc:bees-visible', String(next))
    EffectBus.emit('render:set-bees-visible', { visible: next })
  }

  // ── show hidden items ────────────────────────────────

  readonly toggleShowHidden = (): void => {
    const next = !this.#showHidden()
    this.#showHidden.set(next)
    localStorage.setItem('hc:show-hidden', next ? '1' : '0')
    EffectBus.emit('visibility:show-hidden', { active: next })
  }

  // ── voice ────────────────────────────────────────────

  readonly toggleVoice = (): void => {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }

  // ── room ────────────────────────────────────────────

  readonly toggleRoom = (): void => {
    if (this.#roomOpen()) {
      // closing: save current value (including empty to clear)
      const value = this.#roomValue().trim()
      this.roomStore?.set(value)
      EffectBus.emit('mesh:room', { room: value })
      this.#roomOpen.set(false)
    } else {
      // opening: load stored value and focus
      const stored = this.roomStore?.value ?? ''
      if (stored) this.#roomValue.set(stored)
      this.#roomOpen.set(true)
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('.room-input')?.focus()
      })
    }
  }

  readonly onRoomInput = (event: Event): void => {
    this.#roomValue.set((event.target as HTMLInputElement).value)
  }

  readonly submitRoom = (): void => {
    const value = this.#roomValue().trim()
    this.roomStore?.set(value)
    EffectBus.emit('mesh:room', { room: value })
    this.#roomOpen.set(false)
  }
  // ── hover / idle ──────────────────────────────────────

  readonly onBarEnter = (): void => { this.#hovered.set(true) }
  readonly onBarLeave = (): void => { this.#hovered.set(false) }

  // ── swipe-to-go-back (right-to-left from right edge) ──

  #onSwipeStart = (e: TouchEvent): void => {
    if (!this.isMobile() || !this.canGoBack()) return
    const touch = e.touches[0]
    // only start from the right 40px edge of the screen
    if (touch.clientX < window.innerWidth - this.#SWIPE_EDGE_ZONE) return
    this.#swipeStartX = touch.clientX
    this.#swipeStartY = touch.clientY
    this.#swipeActive = true
  }

  #onSwipeMove = (e: TouchEvent): void => {
    if (!this.#swipeActive) return
    const touch = e.touches[0]
    const dx = this.#swipeStartX - touch.clientX  // positive = left swipe
    const dy = Math.abs(touch.clientY - this.#swipeStartY)

    // check angle — must be mostly horizontal
    const angle = Math.atan2(dy, Math.abs(dx)) * (180 / Math.PI)
    if (angle > this.#SWIPE_ANGLE_MAX) {
      this.#swipeActive = false
      this.swipeIndicatorActive.set(false)
      return
    }

    // show indicator when swiping left past 20px
    this.swipeIndicatorActive.set(dx > 20)
  }

  #onSwipeEnd = (e: TouchEvent): void => {
    if (!this.#swipeActive) {
      this.swipeIndicatorActive.set(false)
      return
    }

    const touch = e.changedTouches[0]
    const dx = this.#swipeStartX - touch.clientX

    this.#swipeActive = false
    this.swipeIndicatorActive.set(false)

    if (dx >= this.#SWIPE_THRESHOLD && this.canGoBack()) {
      this.goBack()
    }
  }

  // ── internal ────────────────────────────────────────────

  #onResize = (): void => {
    // clamp persisted pill position to viewport on window resize
    const pos = this.#pillPos()
    if (pos) this.#pillPos.set(this.#clampPillPos(pos.x, pos.y))
    // recompute pill zoom for new viewport width
    this.#pillZoom.set(this.#computePillZoom())
  }

  // ── pill drag-to-move ─────────────────────────────────────

  readonly onPillDragStart = (e: PointerEvent): void => {
    e.preventDefault()
    const stage = (e.currentTarget as HTMLElement)?.closest('.pill-stage') as HTMLElement | null
    if (!stage) return
    this.#pillStageEl = stage
    const rect = stage.getBoundingClientRect()
    // Start from current visual position (whether default or persisted).
    const startX = rect.left
    const startY = rect.top
    this.#pillDragOffsetX = e.clientX - startX
    this.#pillDragOffsetY = e.clientY - startY
    this.#pillPointerId = e.pointerId
    this.#pillDragging.set(true)
    // Commit to explicit coords on first move so the transform override
    // (translateX(-50%)) no longer fights us.
    this.#pillPos.set({ x: startX, y: startY })
    window.addEventListener('pointermove', this.#onPillDragMove)
    window.addEventListener('pointerup', this.#onPillDragEnd)
  }

  #onPillDragMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pillPointerId) return
    const x = e.clientX - this.#pillDragOffsetX
    const y = e.clientY - this.#pillDragOffsetY
    this.#pillPos.set(this.#clampPillPos(x, y))
  }

  #onPillDragEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pillPointerId) return
    this.#pillPointerId = null
    this.#pillDragging.set(false)
    const pos = this.#pillPos()
    if (pos) {
      try { localStorage.setItem(PILL_POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
    }
    window.removeEventListener('pointermove', this.#onPillDragMove)
    window.removeEventListener('pointerup', this.#onPillDragEnd)
  }

  #clampPillPos(x: number, y: number): { x: number; y: number } {
    // Lazily resolve the stage element so clamping is accurate even
    // before the first drag (window resize, localStorage restore).
    if (!this.#pillStageEl) {
      this.#pillStageEl = this.#host.nativeElement.querySelector('.pill-stage')
    }
    const w = this.#pillStageEl?.offsetWidth ?? 0
    const h = this.#pillStageEl?.offsetHeight ?? 0
    const maxX = Math.max(0, window.innerWidth - w)
    const maxY = Math.max(0, window.innerHeight - h)
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    }
  }

  #restorePillPos(): void {
    try {
      const raw = localStorage.getItem(PILL_POS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { x: number; y: number }
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        this.#pillPos.set(parsed)
      }
    } catch { /* ignore */ }
  }

  #onActivity = (): void => {
    this.#idle.set(false)
    this.#resetIdleTimer()
  }

  #resetIdleTimer = (): void => {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => this.#idle.set(true), this.#IDLE_DELAY)
  }

  // ── power key tracking ────────────────────────────────

  #onPowerKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Control' || e.key === 'Meta') this.powerKey.set('ctrl')
    else if (e.key === 'Shift') this.powerKey.set('shift')
    else if (e.key === 'Alt') this.powerKey.set('alt')
  }

  #onPowerKeyUp = (e: KeyboardEvent): void => {
    const k = this.powerKey()
    if ((k === 'ctrl' && (e.key === 'Control' || e.key === 'Meta'))
      || (k === 'shift' && e.key === 'Shift')
      || (k === 'alt' && e.key === 'Alt')) {
      this.powerKey.set(null)
    }
  }

  #onPowerKeyReset = (): void => { this.powerKey.set(null) }
}

/** Deterministic vibrant HSL color from a tag name — avoids grays. */
function tagNameToColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const hue = ((hash >>> 0) % 360)
  return `hsl(${hue}, 70%, 65%)`
}

/** Extract hue (0-360) from any CSS color string for sorting. */
function extractHue(color: string): number {
  // fast path: hsl(H, ...)
  const hslMatch = color.match(/hsl\(\s*(\d+)/)
  if (hslMatch) return parseInt(hslMatch[1], 10)

  // rgb(...) or hex → convert to hue
  let r = 0, g = 0, b = 0
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgbMatch) {
    r = parseInt(rgbMatch[1], 10) / 255
    g = parseInt(rgbMatch[2], 10) / 255
    b = parseInt(rgbMatch[3], 10) / 255
  } else if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color.slice(1, 7)
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  } else {
    return 0
  }

  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h = 0
  if (max === r) h = ((g - b) / d + 6) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return Math.round(h * 60)
}
