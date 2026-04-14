// hypercomb-shared/ui/command-line/command-line.component.ts

import { AfterViewInit, Component, computed, signal, ViewChild, type OnDestroy } from '@angular/core'
import { CommandShellComponent } from '../command-shell/command-shell.component'
import { HintBarComponent } from '../hint-bar/hint-bar.component'
import type { Lineage } from '../../core/lineage'
import type { MovementService } from '../../core/movement.service'
import type { Navigation } from '../../core/navigation'
import type { ScriptPreloader } from '../../core/script-preloader'
import type { CellSuggestionProvider } from '../../core/cell-suggestion.provider'
import type { CompletionUtility, CompletionContext } from '@hypercomb/shared/core/completion-utility'
import { fromRuntime } from '../../core/from-runtime'
import { readTagProps, writeTagProps, persistTagOps, type TagOp } from '../../core/tag-ops'
import { EffectBus, hypercomb, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { VoiceInputService } from '../../core/voice-input.service'
import type { CommandLineBehavior, CommandLineBehaviorMeta, CommandLineOperation } from './command-line-behavior'
import { ShiftEnterNavigateBehavior } from './shift-enter-navigate.behavior'
import { BatchCreateBehavior } from './batch-create.behavior'
import { RemoveCellBehavior } from './remove-cell.behavior'
import { GoParentBehavior } from './go-parent.behavior'
import { CutPasteBehavior } from './cut-paste.behavior'
import { HashMarkerBehavior } from './hash-marker.behavior'
import { SlashBehaviourBehavior } from './slash-behaviour.behavior'
import { SELECT_OPS } from './select-ops'

const BUILTIN_SLASH: { behaviour: { name: string; description: string; descriptionKey: string }; provider: null }[] = [
  { behaviour: { name: 'select', description: 'select tiles for cut/copy/move', descriptionKey: 'slash.select' }, provider: null },
  { behaviour: { name: 'remove', description: 'remove selected tiles', descriptionKey: 'slash.remove-builtin' }, provider: null },
]

/** Threshold between a tap and a long-press on the mobile mic button (ms). */
const MIC_LONG_PRESS_MS = 300

/** Matches label:tagName or label:tagName(#color) (plain colon syntax, no brackets). */
const TAG_ASSIGN_RE = /^([^:]+):([^(]+)(?:\(([^)]+)\))?$/

/** Matches cell:[...] bracket-tag syntax — colon before opening bracket. */
const BRACKET_TAG_RE = /^([^\[\/!#~]+):\[(.+?)\](.*)$/

/**
 * Bracket commands — any `/command[items]` that is internally a select operation.
 * `/format[abc]` is a shorthand for `/select[abc]/format`, etc.
 * The regex matches the prefix; `normalizeSelectInput` rewrites to `/select[`.
 */
const BRACKET_CMD_RE = /^\/(select|format|fmt|fp)\[/i
/** Normalise any bracket command to `/select[...` form for shared parsing. */
function normalizeSelectInput(v: string): string {
  if (v.match(/^\/select\[/)) return v

  // Bracket-first syntax: [items]/op... → /select[items]/op...
  if (v.startsWith('[')) {
    const close = v.indexOf(']')
    if (close > 1 && v[close + 1] === '/') {
      const afterSlash = v.slice(close + 2)
      const nextSlash = afterSlash.indexOf('/')
      const firstSeg = (nextSlash === -1 ? afterSlash : afterSlash.slice(0, nextSlash)).toLowerCase().replace(/\(.*$/, '')
      if (SELECT_OPS.has(firstSeg)) {
        const items = v.slice(1, close)
        const tail = firstSeg === 'select'
          ? (nextSlash === -1 ? '' : afterSlash.slice(nextSlash))
          : '/' + afterSlash
        return '/select[' + items + ']' + tail
      }
    }
    return v
  }

  const m = v.match(/^\/(format|fmt|fp)\[/i)
  if (!m) return v
  const op = m[1].toLowerCase()
  const rest = v.slice(m[0].length) // everything after the opening bracket
  const bracketClose = rest.indexOf(']')
  if (bracketClose < 0) {
    // bracket still open: /format[abc → /select[abc
    return '/select[' + rest
  }
  // bracket closed: /format[abc] → /select[abc]/format
  return '/select[' + rest.slice(0, bracketClose) + ']/' + (op === 'fmt' || op === 'fp' ? 'format' : op) + rest.slice(bracketClose + 1)
}

/** Check if input is any form of select command (slash-first or bracket-first). */
function isSelectInput(v: string): boolean {
  if (BRACKET_CMD_RE.test(v)) return true
  if (!v.startsWith('[')) return false
  const close = v.indexOf(']')
  if (close <= 1 || v[close + 1] !== '/') return false
  const afterSlash = v.slice(close + 2)
  const nextSlash = afterSlash.indexOf('/')
  const firstSeg = (nextSlash === -1 ? afterSlash : afterSlash.slice(0, nextSlash)).toLowerCase().replace(/\(.*$/, '')
  return SELECT_OPS.has(firstSeg)
}

const MOVE_ARROW_OFFSETS: Record<string, { dq: number; dr: number }> = {
  ArrowLeft:  { dq: -1, dr:  0 },
  ArrowRight: { dq:  1, dr:  0 },
  ArrowUp:    { dq:  0, dr: -1 },
  ArrowDown:  { dq:  0, dr:  1 },
}

@Component({
  selector: 'hc-command-line',
  standalone: true,
  imports: [CommandShellComponent, HintBarComponent, TranslatePipe],
  templateUrl: './command-line.component.html',
  styleUrls: ['./command-line.component.scss'],
  host: {
    '[class.mobile-hidden]': 'mobileHidden()',
  },
})
export class CommandLineComponent implements AfterViewInit, OnDestroy {

  @ViewChild('shell')
  private shell!: CommandShellComponent

  // Resolve via IoC container (not Angular DI) — these are shared services
  // registered at module load time, available globally via get()
  private get completions(): CompletionUtility { return get('@hypercomb.social/CompletionUtility') as CompletionUtility }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get movement(): MovementService { return get('@hypercomb.social/MovementService') as MovementService }
  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }
  private get preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }
  private get cellProvider(): CellSuggestionProvider { return get('@hypercomb.social/CellSuggestionProvider') as CellSuggestionProvider }

  private readonly value = signal('')
  private readonly cellSubPath = signal<readonly string[]>([])
  private readonly cellLeaf = signal('')
  /** Tags currently assigned to the cell in bracket-tag mode (for intellisense filtering). */
  readonly #bracketCellTags = signal<ReadonlySet<string>>(new Set())
  #bracketCellLabel = ''

  // slash behaviour matches — queries the drone via IoC when in slash mode
  // includes built-in behaviours (select) alongside queen bee behaviours
  readonly #slashMatches = computed(() => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return []
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as any
    const droneMatches = drone?.match ? drone.match(ctx.normalized) as { behaviour: { name: string; description: string }; provider: unknown }[] : []
    const t = this.#i18n
    const builtinMatches = BUILTIN_SLASH.filter(b =>
      !ctx.normalized || b.behaviour.name.startsWith(ctx.normalized)
    ).map(b => ({
      behaviour: { name: b.behaviour.name, description: t?.t(b.behaviour.descriptionKey) ?? b.behaviour.description },
      provider: null,
    }))
    return [...builtinMatches, ...droneMatches]
  })

  readonly slashDescriptionMap = computed<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>()
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return map
    for (const m of this.#slashMatches()) {
      map.set(m.behaviour.name, m.behaviour.description)
    }
    return map
  })

  /** Prefix of the current suggestion fragment — used by shell for highlight split. */
  readonly completionTypedPrefix = computed<string>(() => {
    const ctx = this.context()
    if (!ctx.active) return ''

    const bracketPhase = this.#bracketPhase()
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      return this.cellLeaf()
    }

    const subPath = this.cellSubPath()
    if (subPath.length > 0) {
      return this.cellLeaf()
    }

    return this.completions.render(ctx.normalized, ctx.style)
  })


  /**
   * Generic slash command arg extraction. Detects `/command args` or `/command[args`
   * for any command that has completions registered via SlashBehaviourDrone.complete().
   * Returns { command, fragment, fullArgs } or null if not in arg mode.
   */
  #extractSlashCommandArgs(raw: string): { command: string; fragment: string; fullArgs: string } | null {
    const spaceIdx = raw.indexOf(' ')
    const bracketIdx = raw.indexOf('[')

    // Need at least a space or bracket after the command name
    if (spaceIdx <= 0 && bracketIdx <= 0) return null

    // Determine separator position (whichever comes first)
    let sepIdx: number
    if (spaceIdx > 0 && (bracketIdx < 0 || spaceIdx < bracketIdx)) {
      sepIdx = spaceIdx
    } else if (bracketIdx > 0) {
      sepIdx = bracketIdx
    } else {
      return null
    }

    const command = raw.slice(0, sepIdx).toLowerCase()

    // Verify this is an exact match for a known slash command (including aliases)
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { complete?(name: string, args: string): readonly string[]; match?(q: string): { behaviour: { name: string } }[] } | undefined
    if (!drone?.match) return null
    const matches = drone.match(command)
    const isExactMatch = matches.some(m => m.behaviour.name === command)
    if (!isExactMatch) return null

    // Build full args string (everything after the command name)
    const fullArgs = raw.slice(sepIdx === spaceIdx ? spaceIdx + 1 : sepIdx)

    // Bracket mode: find current fragment
    const bStart = fullArgs.indexOf('[')
    if (bStart >= 0 || raw[sepIdx] === '[') {
      const actualBStart = bStart >= 0 ? bStart : 0
      const inner = fullArgs.slice(actualBStart + (fullArgs[actualBStart] === '[' ? 1 : 0))
      const bracketClose = inner.indexOf(']')
      if (bracketClose < 0) {
        // Inside brackets — fragment is after last comma
        const lastComma = inner.lastIndexOf(',')
        const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trimStart() : inner.trimStart()
        return { command, fragment, fullArgs }
      }
      // After closed brackets
      const after = inner.slice(bracketClose + 1).trimStart()
      return { command, fragment: after, fullArgs }
    }

    // Space mode: fragment is the last whitespace-separated token
    const parts = fullArgs.split(/\s+/)
    const fragment = parts[parts.length - 1] ?? ''
    return { command, fragment, fullArgs }
  }

  // Bridge EventTarget-based services to Angular Signals for reactivity
  private readonly resourceCount$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.resourceCount
  )
  private readonly actionNames$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.actionNames
  )
  private readonly cellNames$ = fromRuntime(
    get('@hypercomb.social/CellSuggestionProvider') as EventTarget,
    () => this.cellProvider.suggestions()
  )

  // pluggable behaviors — validated at construction, no overlapping operations
  #behaviors: CommandLineBehavior[] = this.#validateBehaviors([
    new GoParentBehavior(),
    new SlashBehaviourBehavior(),
    new RemoveCellBehavior(),
    new CutPasteBehavior(),
    new HashMarkerBehavior(),
    new BatchCreateBehavior(),
    new ShiftEnterNavigateBehavior()
  ])

  // built-in behaviors that are hardcoded in onKeyDown (not pluggable yet)
  static readonly builtinBehaviors: readonly CommandLineBehaviorMeta[] = [
    {
      name: 'create',
      operations: [
        {
          trigger: 'Enter',
          pattern: /^[^~\[#/][^/]*$/,
          description: 'Create a new cell at the current level',
          examples: [
            { input: 'hello', key: 'Enter', result: 'Creates cell "hello" at current level' }
          ]
        },
        {
          trigger: 'Enter',
          pattern: /^[^~\[#].+\/.+[^/]$/,
          description: 'Create nested folders, stay at current level with parent path retained',
          examples: [
            { input: 'a/b/c', key: 'Enter', result: 'Creates a/b/c, retains "a/b/" in the bar' }
          ]
        },
        {
          trigger: 'Enter',
          pattern: /^[^~\[#].+\/$/,
          description: 'Go to a folder, creating it if it doesn\'t exist',
          examples: [
            { input: 'abc/', key: 'Enter', result: 'Creates "abc" if needed, then navigates into it' },
            { input: 'a/b/', key: 'Enter', result: 'Creates a/b if needed, then navigates into a/b' }
          ]
        }
      ]
    },
    {
      name: 'filter',
      operations: [
        {
          trigger: 'type',
          pattern: /^>\?.*/,
          description: 'Live-filter visible tiles by keyword',
          examples: [
            { input: '>?cigar', key: 'type', result: 'Filters tiles to those matching "cigar"' }
          ]
        }
      ]
    },
  ]

  /** All behavior metadata — pluggable + built-in */
  public get behaviorReference(): readonly CommandLineBehaviorMeta[] {
    return [
      ...this.#behaviors,
      ...CommandLineComponent.builtinBehaviors
    ]
  }

  /** All operations across all behaviors, flat */
  public get allOperations(): readonly CommandLineOperation[] {
    return this.behaviorReference.flatMap(b => b.operations)
  }

  /**
   * Validate that no two behaviors claim overlapping trigger+pattern space.
   * Uses each operation's examples as probes — if two behaviors both match
   * the same example input under the same trigger, that's a conflict.
   */
  #validateBehaviors(behaviors: CommandLineBehavior[]): CommandLineBehavior[] {
    const claimed = new Map<string, { behavior: string; pattern: RegExp }>()

    for (const b of behaviors) {
      for (const op of b.operations) {
        for (const ex of op.examples) {
          const key = `${op.trigger}::${ex.input}`
          const existing = claimed.get(key)
          if (existing) {
            console.warn(
              `[command-line] overlap: "${b.name}" and "${existing.behavior}" both claim ` +
              `trigger="${op.trigger}" for input "${ex.input}". ` +
              `"${existing.behavior}" wins (registered first).`
            )
          } else {
            claimed.set(key, { behavior: b.name, pattern: op.pattern })
          }
        }
      }
    }

    return behaviors
  }


  // -------------------------------------------------
  // readiness / locking
  // -------------------------------------------------

  private readonly hasAnyResources = computed<boolean>(() => this.resourceCount$() > 0)
  public readonly locked = computed<boolean>(() => !this.hasAnyResources())

  // -------------------------------------------------
  // placeholder
  // -------------------------------------------------

  get #i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }

  public readonly placeholder = computed<string>(() => {
    const t = this.#i18n
    if (this.locked()) return t?.t('command-line.placeholder.locked') ?? 'enter cell name...'
    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') return t?.t('command-line.placeholder.filter') ?? 'filter tiles...'
    if (ctx.active && ctx.mode === 'slash') return t?.t('command-line.placeholder.slash') ?? 'type a command...'
    return t?.t('command-line.placeholder.default') ?? 'share intent...'
  })

  // ── status indicators ─────────────────────────────────

  readonly #indicators = signal<Map<string, { key: string; icon: string; label: string; dismissable?: boolean }>>(new Map())
  readonly activeIndicators = computed(() => [...this.#indicators().values()])

  #indicatorUnsubs: (() => void)[] = []

  public constructor() {
    console.log('[command-line] initialized with url segments:', this.navigation.segments())

    // Listen for indicator registration/removal
    this.#indicatorUnsubs.push(
      EffectBus.on<{ key: string; icon: string; label: string }>('indicator:set', (p) => {
        if (!p?.key) return
        this.#indicators.update(m => { const n = new Map(m); n.set(p.key, p); return n })
        this.#persistIndicators()
      }),
      EffectBus.on<{ key: string }>('indicator:clear', (p) => {
        if (!p?.key) return
        this.#indicators.update(m => { const n = new Map(m); n.delete(p.key); return n })
        this.#persistIndicators()
      }),
    )

    // Restore sticky indicators from localStorage
    const saved = localStorage.getItem('hc:indicators')
    if (saved) {
      try {
        const list = JSON.parse(saved) as { key: string; icon: string; label: string }[]
        const m = new Map<string, { key: string; icon: string; label: string }>()
        for (const ind of list) m.set(ind.key, ind)
        this.#indicators.set(m)
      } catch { /* ignore corrupt data */ }
    }
  }

  onIndicatorDismiss(key: string): void {
    EffectBus.emit('indicator:dismiss', { key })
    this.#indicators.update(m => { const n = new Map(m); n.delete(key); return n })
    this.#persistIndicators()
  }

  #persistIndicators(): void {
    const list = [...this.#indicators().values()]
    if (list.length > 0) {
      localStorage.setItem('hc:indicators', JSON.stringify(list))
    } else {
      localStorage.removeItem('hc:indicators')
    }
  }

  public readonly openDcp = (): void => {
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }

  // -------------------------------------------------
  // completion context
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()

    // >? prefix enters filter mode
    if (v.startsWith('>?')) {
      const raw = v.slice(2)
      const keyword = this.completions.normalize(raw)
      return {
        active: true,
        mode: 'filter',
        head: '>?',
        raw,
        normalized: keyword,
        style: 'space'
      }
    }

    // bracket command mode (/select[, /format[, /fmt[, /fp[) — normalise and parse
    if (isSelectInput(v)) {
      return this.#parseSelectContext(normalizeSelectInput(v))
    }

    // '/' prefix enters slash behaviour mode
    if (v.startsWith('/')) {
      const raw = v.slice(1)

      // detect `/command args` or `/command[args` — generic arg intellisense
      const slashArgs = this.#extractSlashCommandArgs(raw)
      if (slashArgs !== null) {
        const head = v.slice(0, v.length - slashArgs.fragment.length)
        return {
          active: true,
          mode: 'slash',
          head,
          raw: slashArgs.fragment,
          normalized: slashArgs.fragment.toLowerCase().trim(),
          style: 'space'
        }
      }

      return {
        active: true,
        mode: 'slash',
        head: '/',
        raw,
        normalized: raw.toLowerCase().trim(),
        style: 'space'
      }
    }

    // ~ prefix enters remove mode — show cells as intellisense
    // supports: ~name, ~[a,b,c] (intellisense on the current segment)
    // Note: ~name:tag is tag removal (handled by tag pre-processor, not here)
    if (v.startsWith('~') && !v.includes(':')) {
      const body = v.slice(1)
      // find the current segment: after last ',' or '[', or the whole body
      const lastSep = Math.max(body.lastIndexOf(','), body.lastIndexOf('['))
      const raw = lastSep === -1 ? body : body.slice(lastSep + 1)
      const head = v.slice(0, v.length - raw.length)
      const normalized = this.completions.normalize(raw)
      return {
        active: true,
        mode: 'remove',
        head,
        raw,
        normalized,
        style: raw.includes('.') ? 'dot' : 'space'
      }
    }

    const lastHash = v.lastIndexOf('#')

    if (lastHash !== -1) {
      const after = v.slice(lastHash + 1)
      const leadingWs = after.match(/^\s*/)?.[0] ?? ''
      const raw = after.slice(leadingWs.length)

      return {
        active: true,
        mode: 'marker',
        head: v.slice(0, lastHash + 1) + leadingWs,
        raw,
        normalized: this.completions.normalize(raw),
        style: raw.includes('.') ? 'dot' : 'space'
      }
    }

    if (!v.trim()) return { active: false }

    // plain colon tag syntax: label:tagPrefix or ~label:tagPrefix
    // must not be bracket syntax (label:[...) and colon must be present
    const colonIdx = v.indexOf(':')
    if (colonIdx > 0 && !v.includes('[')) {
      const raw = v.slice(colonIdx + 1)
      return {
        active: true,
        mode: 'tag',
        head: v.slice(0, colonIdx + 1),
        raw,
        normalized: raw.toLowerCase().trim(),
        style: 'space' as const
      }
    }

    return {
      active: true,
      mode: 'action',
      head: '',
      raw: v,
      normalized: this.completions.normalize(v),
      style: v.includes('.') ? 'dot' : 'space'
    }
  })

  // -------------------------------------------------
  // suggestions
  // -------------------------------------------------

  public readonly suggestions = computed<readonly string[]>(() => {
    if (this.shell?.suppressed()) return []

    const ctx = this.context()
    if (!ctx.active) return []
    if (ctx.mode === 'filter') return []
    if (ctx.mode === 'slash') {
      // Detect slash command with args: head matches /command followed by space or bracket
      const cmdArgMatch = ctx.head.match(/^\/(\S+?)[\s\[]/i)
      if (cmdArgMatch) {
        const cmdName = cmdArgMatch[1].toLowerCase()
        const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
          { complete?(name: string, args: string): readonly string[] } | undefined
        if (drone?.complete) {
          // Reconstruct full args from head (after command+separator) + current fragment
          const cmdPrefix = cmdArgMatch[0]
          const headArgs = ctx.head.slice(cmdPrefix.length)
          const fullArgs = ctx.head[cmdPrefix.length - 1] === '[' ? '[' + headArgs + ctx.raw : headArgs + ctx.raw
          return [...drone.complete(cmdName, fullArgs)]
        }
      }
      return this.#slashMatches().map(m => m.behaviour.name)
    }

    // plain colon tag mode: suggest tag names from registry
    if (ctx.mode === 'tag') {
      const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
      const allTags = registry?.names ?? []
      if (!ctx.normalized) return allTags
      return allTags.filter(n => n.toLowerCase().startsWith(ctx.normalized))
    }

    // select mode: suggestions depend on the current phase
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()

      // selection phase: show tile names, exclude already-selected
      if (phase === 'selection') {
        let cells = this.cellNames$()
        const excluded = this.#selectExcluded()
        if (excluded.size) cells = cells.filter(n => !excluded.has(n))
        if (!ctx.normalized) return cells
        return cells.filter(n => n.startsWith(ctx.normalized))
      }

      // operation phase: suggest operation keywords with / prefix
      if (phase === 'operation') {
        const ops = ['/cut', '/copy', '/move', '/keyword', '/remove', '/delete', '/format', '/accent', '/opus', '/sonnet', '/haiku']
        if (!ctx.normalized) return ops
        return ops.filter(o => o.startsWith('/' + ctx.normalized) || o.slice(1).startsWith(ctx.normalized))
      }

      // move-path phase: suggest child directories at the current navigation depth
      if (phase === 'move-path') {
        const cells = this.cellNames$()
        if (!ctx.normalized) return cells
        return cells.filter(n => n.startsWith(ctx.normalized))
      }

      // move-target-swap phase: suggest tile names at target directory
      if (phase === 'move-target-swap') {
        const cells = this.cellNames$()
        if (!ctx.normalized) return cells
        return cells.filter(n => n.startsWith(ctx.normalized))
      }

      // move-target-index: no suggestions (numeric input)
      return []
    }

    // remove mode: show only cells (tiles) that can be removed
    // exclude items already chosen in bracket syntax ~[a,b,...]
    if (ctx.mode === 'remove') {
      const already = new Set<string>()
      const bracketMatch = ctx.head.match(/\[(.+)/)
      if (bracketMatch) {
        for (const item of bracketMatch[1].split(',')) {
          const n = this.completions.normalize(item)
          if (n) already.add(n)
        }
      }
      let cells = this.cellNames$()
      if (already.size) cells = cells.filter(n => !already.has(n))
      if (!ctx.normalized) return cells
      return cells.filter(n => n.startsWith(ctx.normalized))
    }

    const bracketPhase = this.#bracketPhase()
    const subPath = this.cellSubPath()
    const leaf = this.cellLeaf()
    const cells = this.cellNames$()
    const actions = this.actionNames$()

    // bracket mode: filter by cellLeaf instead of ctx.normalized
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      // tag intellisense: when leaf starts with : or ~:, suggest tag names
      if (leaf.startsWith(':') || leaf.startsWith('~:')) {
        const isRemove = leaf.startsWith('~:')
        const prefix = isRemove ? leaf.slice(2) : leaf.slice(1)
        const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
        const allTags = registry?.names ?? []
        const cellTags = this.#bracketCellTags()
        const pending = this.#bracketPendingTags

        let candidates: string[]
        if (isRemove) {
          // ~: → only tags currently ON the cell (minus ones already queued for removal)
          candidates = allTags.filter(n => cellTags.has(n) && !pending.removes.has(n))
        } else {
          // : → only tags NOT on the cell (minus ones already queued for addition)
          candidates = allTags.filter(n => !cellTags.has(n) && !pending.adds.has(n))
        }

        if (!prefix) return candidates
        return candidates.filter(n => n.startsWith(prefix))
      }
      if (subPath.length > 0) {
        if (!leaf) return cells
        return cells.filter(n => n.startsWith(leaf))
      }
      // current level cells only (no actions in bracket mode)
      if (!leaf) return cells
      return cells.filter(n => n.startsWith(leaf))
    }

    // when in a sub-path (e.g. "abc/"), show only cells at that level
    if (subPath.length > 0) {
      if (!leaf) return cells
      return cells.filter(n => n.startsWith(leaf))
    }

    // at root level: merge cells + actions, deduplicated
    const seen = new Set<string>()
    const merged: string[] = []
    for (const name of cells) {
      if (seen.has(name)) continue
      seen.add(name)
      merged.push(name)
    }
    for (const name of actions) {
      if (seen.has(name)) continue
      seen.add(name)
      merged.push(name)
    }

    if (!ctx.normalized) return merged

    return merged.filter(n => n.startsWith(ctx.normalized))
  })

  public readonly showCompletions = computed<boolean>(() => {
    if (!this.suggestions().length) return false
    // inside bracket remove syntax: ghost text only, no dropdown
    const ctx = this.context()
    if (ctx.active && ctx.mode === 'remove' && ctx.head.includes(',')) return false
    return true
  })

  // -------------------------------------------------
  // hint bar (intellisense breadcrumbs)
  // -------------------------------------------------

  static readonly ACCENT_PRESETS: readonly string[] = ['glacier', 'bloom', 'aurora', 'ember', 'nebula']

  /** CSS colors for each accent preset (derived from shader RGB values). */
  static readonly ACCENT_COLOR_MAP: ReadonlyMap<string, string> = new Map([
    ['glacier', 'rgb(102, 217, 255)'],
    ['bloom',   'rgb(255, 102, 179)'],
    ['aurora',  'rgb(51, 255, 153)'],
    ['ember',   'rgb(255, 153, 38)'],
    ['nebula',  'rgb(166, 89, 255)'],
  ])

  /** Full set of hint items — shown when accent mode is active. */
  public readonly hintItems = computed<readonly string[]>(() => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return []
    const isAccent = ctx.head.match(/^\/(accent|ac)[\s\[]/i)
    if (!isAccent) return []
    // In preset phase, show all 5 presets
    const inBrackets = ctx.head.includes('[') && !ctx.head.includes(']')
    if (inBrackets) return []   // tags phase — hint bar not needed
    return CommandLineComponent.ACCENT_PRESETS
  })

  /** Current filter for the hint bar — typed fragment. */
  public readonly hintFilter = computed<string>(() => {
    const ctx = this.context()
    if (!ctx.active) return ''
    return ctx.normalized
  })

  /** Items already chosen in the hint bar. */
  public readonly hintChosen = computed<ReadonlySet<string>>(() => {
    return new Set<string>()
  })

  /** Accent color map — active when in accent command context. */
  public readonly accentColorMap = computed<ReadonlyMap<string, string>>(() => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return new Map()
    const isAccent = ctx.head.match(/^\/(accent|ac)[\s\[]/i)
    if (!isAccent) return new Map()
    return CommandLineComponent.ACCENT_COLOR_MAP
  })

  /** Handle a hint-bar crumb click — accept that preset. */
  public onHintPick(preset: string): void {
    const ctx = this.context()
    if (!ctx.active) return
    this.#setShellValue(ctx.head + preset, true)
  }

  // -------------------------------------------------
  // ghost mirror (second input layer)
  // -------------------------------------------------

  public readonly ghostValue = computed<string>(() => {
    if (!this.suggestions().length) return ''

    const ctx = this.context()
    if (!ctx.active) return ''

    const list = this.suggestions()
    const best = list[this.shell?.activeIndex() ?? 0] ?? list[0]
    if (!best) return ''

    const subPath = this.cellSubPath()
    const leaf = this.cellLeaf()
    const current = this.value()
    const bracketPhase = this.#bracketPhase()

    // select mode: ghost text for operation/path/swap suggestions
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()
      if (phase === 'operation') {
        // operation suggestions include '/' prefix — build ghost from head + suggestion
        const bracketClose = current.indexOf(']')
        if (bracketClose >= 0) {
          const prefix = current.slice(0, bracketClose + 1)
          const op = best.startsWith('/') ? best : '/' + best
          return prefix + op
        }
      }
      // selection/path/swap: use head + raw suffix
      if (!best.startsWith(ctx.normalized) && ctx.normalized) return ''
      const suffix = best.slice(ctx.normalized.length)
      if (!suffix) return ''
      return current + suffix
    }

    // bracket mode: ghost shows the completion suffix for the active fragment
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      // tag suggestions: leaf is `:prefix` or `~:prefix`, best is the raw tag name
      if (leaf.startsWith(':') || leaf.startsWith('~:')) {
        const prefix = leaf.startsWith('~:') ? leaf.slice(2) : leaf.slice(1)
        if (!best.startsWith(prefix)) return ''
        const suffix = best.slice(prefix.length)
        if (!suffix) return ''
        return current + suffix
      }
      if (!best.startsWith(leaf)) return ''
      const suffix = best.slice(leaf.length)
      if (!suffix) return ''
      return current + suffix
    }

    // sub-path mode: suggestion is a child name, leaf is the typed fragment
    if (subPath.length > 0) {
      if (!best.startsWith(leaf)) return ''
      const suffix = best.slice(leaf.length)
      if (!suffix) return ''
      return current + suffix
    }

    if (!best.startsWith(ctx.normalized)) return ''

    const rendered = this.completions.render(best, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)

    let suffix = rendered.slice(prefix.length)
    if (!suffix) return ''

    const last = current.slice(-1)

    if ((last === '.' || /\s/.test(last)) && (suffix.startsWith('.') || suffix.startsWith(' '))) {
      suffix = suffix.slice(1)
    }

    return current + suffix
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public ngAfterViewInit(): void {
    this.shell?.focus()

    window.addEventListener('navigate', this.#onNavigate)
    window.addEventListener('popstate', this.#onNavigate)
    this.#commandLineToggleUnsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd !== 'ui.commandLineToggle') return
      this.shell?.focus()
    })

    this.#prefillUnsub = EffectBus.on<{ value: string }>('search:prefill', ({ value }) => {
      this.#setShellValue(value, false)
    })

    this.#commandFocusUnsub = EffectBus.on<{ cell: string }>('command:focus', ({ cell }) => {
      this.#setShellValue(cell, false)
      this.shell?.focus()
    })

    this.#touchDraggingUnsub = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      this.touchDragging.set(active)
      if (active) {
        this.shell?.suppress()
      }
    })

    this.#viewActiveUnsub = EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive.set(active)
    })

    // Mobile input visibility — controls-bar emits this; on mobile the
    // command line is collapsed by default and only expanded when the
    // user taps the toggle icon. On desktop, visible is always true.
    this.#mobileVisibilityUnsub = EffectBus.on<{ visible: boolean; mobile: boolean }>(
      'mobile:input-visible',
      ({ visible, mobile }) => {
        this.mobileHidden.set(mobile && !visible)
        if (mobile && visible) {
          // give focus to the shell so the keyboard pops up immediately
          queueMicrotask(() => this.shell?.focus())
        }
      },
    )

    // Bi-directional sync: external selection changes → update command line
    this.#selectionSyncUnsub = EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', (payload) => {
      if (this.#syncDirection === 'command') return // prevent feedback loop
      if (!payload?.selected) return

      const selected = payload.selected
      if (selected.length === 0) {
        this.#indicators.update(m => { const n = new Map(m); n.delete('move-hint'); return n })
        if (this.#selectPhase() !== 'none') {
          this.clear()
        }
        return
      }

      // show move-hint indicator when tiles are selected
      this.#indicators.update(m => {
        const n = new Map(m)
        n.set('move-hint', { key: 'move-hint', icon: '\u2725', label: 'Move mode', dismissable: false })
        return n
      })

      const ctx = this.context()
      if (!ctx.active || ctx.mode === 'select' || this.value() === '') {
        this.#syncDirection = 'visual'
        const currentValue = this.value()
        const bracketCloseIdx = currentValue.indexOf(']')
        const tail = bracketCloseIdx >= 0 ? currentValue.slice(bracketCloseIdx + 1) : ''
        this.#setShellValue(this.#buildSelectValue(selected, this.#shouldTruncate(selected)) + tail, true)
        this.#syncDirection = 'idle'
      }
    })

    // voice input: live interim preview while speaking
    this.#voiceInterimUnsub = EffectBus.on<{ text: string }>('voice:interim', ({ text }) => {
      this.#setShellValue(text, false)
    })

    // voice input: auto-submit on release (push-to-talk complete)
    this.#voiceSubmitUnsub = EffectBus.on<{ text: string }>('voice:submit', ({ text }) => {
      this.#setShellValue(text, false)
      void this.#preprocessTagsThenExecute(text)
    })

    // voice active state sync (for mic button visual)
    this.#voiceActiveUnsub = EffectBus.on<{ active: boolean }>('voice:active', ({ active }) => {
      this.voiceActive.set(active)
    })

    // push-to-talk toggle (from /push-to-talk slash behaviour)
    this.#pushToTalkUnsub = EffectBus.on<{ enabled: boolean }>('push-to-talk:toggle', ({ enabled }) => {
      this.pushToTalkEnabled.set(enabled)
      localStorage.setItem('hc:push-to-talk', String(enabled))
    })

    // mobile mic state machine (controls-bar emits press/release)
    this.#micPressUnsub = EffectBus.on('mobile:mic:press', this.#onMobileMicPress)
    this.#micReleaseUnsub = EffectBus.on('mobile:mic:release', this.#onMobileMicRelease)

    // drop-to-arm: a drop on an empty hex arms a resource in the chevron slot
    this.#armResourceUnsub = EffectBus.on<{
      previewUrl: string
      largeSig: string
      smallPointSig: string | null
      smallFlatSig: string | null
      url: string | null
      type: 'image' | 'youtube' | 'link' | 'document'
    }>('command:arm-resource', (payload) => {
      if (!payload || (!payload.largeSig && !payload.url)) return
      const prev = this.armedResource()
      if (prev?.previewUrl && prev.previewUrl !== payload.previewUrl) {
        try { URL.revokeObjectURL(prev.previewUrl) } catch { /* ignore */ }
      }
      this.armedResource.set(payload)
      this.shell?.focus()
    })
  }

  /** Clear the armed resource (thumbnail click, Escape, or after successful commit). */
  public onArmedResourceDismiss = (): void => {
    const prev = this.armedResource()
    if (prev?.previewUrl) {
      try { URL.revokeObjectURL(prev.previewUrl) } catch { /* ignore */ }
    }
    this.armedResource.set(null)
  }

  readonly touchDragging = signal(false)
  readonly viewActive = signal(false)
  readonly voiceActive = signal(false)

  /** Armed resource from a drop on an empty hex — preview shown in chevron slot until Enter or dismiss. */
  readonly armedResource = signal<{
    previewUrl: string
    largeSig: string
    smallPointSig: string | null
    smallFlatSig: string | null
    url: string | null
    type: 'image' | 'youtube' | 'link' | 'document'
  } | null>(null)
  #armResourceUnsub?: () => void
  /** True when the command-line should be collapsed on mobile (toggle off). */
  readonly mobileHidden = signal(false)
  #mobileVisibilityUnsub?: () => void
  readonly voiceSupported = VoiceInputService.supported()
  readonly pushToTalkEnabled = signal(localStorage.getItem('hc:push-to-talk') === 'true')
  #voiceActiveUnsub?: () => void
  #pushToTalkUnsub?: () => void
  #prefillUnsub?: () => void
  #commandFocusUnsub?: () => void
  #commandLineToggleUnsub?: () => void
  #touchDraggingUnsub?: () => void
  #viewActiveUnsub?: () => void
  #selectionSyncUnsub?: () => void
  #voiceInterimUnsub?: () => void
  #voiceSubmitUnsub?: () => void
  readonly #onNavigate = (): void => { this.clear() }

  // ── voice input (push-to-hold mic button) ────────────

  private get voiceService(): VoiceInputService | undefined {
    return get('@hypercomb.social/VoiceInputService') as VoiceInputService | undefined
  }

  readonly startVoice = (event: PointerEvent): void => {
    ;(event.target as HTMLElement)?.setPointerCapture?.(event.pointerId)
    this.voiceService?.start()
  }

  readonly stopVoice = (): void => {
    this.voiceService?.stop()
  }

  /** Mobile "done" / "GO" button: submit if text, otherwise collapse. */
  readonly closeMobileInput = (): void => {
    const v = this.value().trim()
    if (v) {
      void this.#preprocessTagsThenExecute(this.value())
    }
    EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
  }

  // ── mobile mic state machine ──────────────────────────────
  // Long-press (>300ms hold): record-and-release — stop emits voice:submit
  //   which creates the tile and closes the command line.
  // Tap on closed command line: open it + start listening + focus input.
  // Tap on open command line while listening with no text: stop listening,
  //   keep command line open with keyboard focus for typing.
  // Tap on open command line with text (listening or typing): submit & close.
  #micHoldTimer: ReturnType<typeof setTimeout> | null = null
  #micLongPressFired = false
  #micPressWhileOpen = false
  #micPressUnsub?: () => void
  #micReleaseUnsub?: () => void

  #onMobileMicPress = (): void => {
    this.#micLongPressFired = false
    this.#micPressWhileOpen = !this.mobileHidden()

    if (!this.#micPressWhileOpen) {
      // First tap on a closed command line: open, focus, start listening
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
      queueMicrotask(() => this.shell?.focus())
      this.voiceService?.start()
    }
    // Press while already open: wait — release handler decides tap vs long-press.
    // Long-press starts a fresh dictation (see timer below).

    this.#micHoldTimer = setTimeout(() => {
      this.#micLongPressFired = true
      this.#micHoldTimer = null
      // Long-press while command line was already open (and voice idle) —
      // user is initiating a new dictation. Start voice now.
      if (this.#micPressWhileOpen && !this.voiceActive()) {
        this.voiceService?.start()
      }
    }, MIC_LONG_PRESS_MS)
  }

  #onMobileMicRelease = (): void => {
    const wasLongPress = this.#micLongPressFired
    const wasPressWhileOpen = this.#micPressWhileOpen
    if (this.#micHoldTimer) {
      clearTimeout(this.#micHoldTimer)
      this.#micHoldTimer = null
    }
    this.#micLongPressFired = false

    if (wasLongPress) {
      this.voiceService?.stop()
      EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
      return
    }

    if (!wasPressWhileOpen) return

    const isListening = this.voiceActive()
    const hasText = this.value().trim().length > 0

    if (isListening && !hasText) {
      this.voiceService?.stop()
      queueMicrotask(() => this.shell?.focus())
      return
    }

    if (isListening) {
      this.voiceService?.stop()
    } else {
      void this.#preprocessTagsThenExecute(this.value())
    }
    EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
  }

  public ngOnDestroy(): void {
    this.#prefillUnsub?.()
    this.#commandFocusUnsub?.()
    this.#commandLineToggleUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#viewActiveUnsub?.()
    this.#mobileVisibilityUnsub?.()
    this.#selectionSyncUnsub?.()
    this.#voiceInterimUnsub?.()
    this.#voiceSubmitUnsub?.()
    this.#voiceActiveUnsub?.()
    this.#pushToTalkUnsub?.()
    this.#micPressUnsub?.()
    this.#micReleaseUnsub?.()
    this.#armResourceUnsub?.()
    this.onArmedResourceDismiss()
    if (this.#micHoldTimer) {
      clearTimeout(this.#micHoldTimer)
      this.#micHoldTimer = null
    }
    for (const unsub of this.#indicatorUnsubs) unsub()
    window.removeEventListener('navigate', this.#onNavigate)
    window.removeEventListener('popstate', this.#onNavigate)
  }

  // template helpers removed — now owned by CommandShellComponent

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  /** Bridge: shell value changed (fires on every keystroke). */
  public onShellValueChange = (v: string): void => {
    this.value.set(v)

    // auto-populate index when typing '(' after /move
    if (this.#autoPopulateMoveIndex(v)) {
      // shell value was mutated — re-sync
    }

    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') {
      EffectBus.emit('search:filter', { keyword: ctx.normalized })
    } else if (this.lastFilterKeyword) {
      EffectBus.emit('search:filter', { keyword: '' })
      this.lastFilterKeyword = ''
    }
    if (ctx.active && ctx.mode === 'filter') {
      this.lastFilterKeyword = ctx.normalized
    }

    // select mode side-effects: index overlay, move preview, real-time navigation
    if (ctx.active && ctx.mode === 'select') {
      this.#handleSelectInputEffects()
    } else if (this.#lastSelectMode) {
      // Exited select mode — clear selection
      this.#syncDirection = 'command'
      const selection = get('@diamondcoreprocessor.com/SelectionService') as any
      if (selection?.count > 0) selection.clear()
      this.#syncDirection = 'idle'
    }
    this.#lastSelectMode = ctx.active && ctx.mode === 'select'

    // update cell sub-path query when input contains '/'
    this.updateCellSubPath()
  }

  private lastFilterKeyword = ''

  /** Bridge: shell forwarded a keydown it didn't consume (not Escape/Up/Down/Tab/Enter). */
  public onShellKeydown = (e: KeyboardEvent): void => {
    const v = this.value()

    // Escape in select mode: collapse back to /select[tiles] or clear
    if (e.key === 'Escape' && this.#selectPhase() !== 'none') {
      e.preventDefault()
      this.#cancelSelectOperation()
      return
    }

    // Escape with an armed resource — dismiss it (chevron restores)
    if (e.key === 'Escape' && this.armedResource()) {
      e.preventDefault()
      this.onArmedResourceDismiss()
      return
    }

    // Escape peels back one path segment so the user can drop back up a
    // level and keep adding cells there. With no '/' left, it clears.
    if (e.key === 'Escape' && v.length > 0) {
      e.preventDefault()
      const trimmed = v.endsWith('/') ? v.slice(0, -1) : v
      const lastSlash = trimmed.lastIndexOf('/')
      const next = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : ''
      this.#setShellValue(next, true)
      return
    }

    // Arrow keys inside /move(N) — scrub index (works with or without /select[...] prefix)
    if (this.#isInMoveParen(v)) {
      if ((e.ctrlKey || e.metaKey) && this.#handleMoveScrub(e)) return
      if (!e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        this.#scrubMoveIndex(e.key === 'ArrowUp' ? -1 : 1)
        return
      }
    }

    // Plain Up/Down in move-target-index: increment/decrement the index number.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.#selectPhase() === 'move-target-index') {
      e.preventDefault()
      const parenIdx = v.lastIndexOf('(')
      if (parenIdx >= 0) {
        const raw = v.slice(parenIdx + 1).replace(/\)$/, '')
        const current = raw === '' ? 0 : parseInt(raw, 10)
        if (!isNaN(current)) {
          const next = e.key === 'ArrowUp' ? current + 1 : Math.max(0, current - 1)
          this.shell?.setValue(v.slice(0, parenIdx + 1) + next)
          this.value.set(this.shell?.value() ?? '')
        }
      }
      return
    }
  }

  /** Bridge: shell Enter pressed — tag pre-process then execute. */
  public onShellCommit = (v: string): void => {
    void this.#preprocessTagsThenExecute(v)
  }

  /**
   * Pre-process tags from input, persist them, then dispatch to the appropriate handler
   * with the cleaned input (tag syntax stripped).
   */
  async #preprocessTagsThenExecute(original: string): Promise<void> {
    const cleaned = await this.#extractAndPersistTags(original)

    // Update the shell value with cleaned value (tags stripped)
    if (cleaned !== original) {
      this.shell?.setValue(cleaned)
      this.value.set(cleaned)
    }

    const v = cleaned

    // If only tag ops with nothing left, just clear and return
    if (!v.trim()) {
      this.clear()
      return
    }

    // bracket command execution (/select[, /format[, /fmt[, /fp[)
    if (isSelectInput(v)) {
      this.shell?.setValue(normalizeSelectInput(v))
      this.value.set(this.shell?.value() ?? '')
      void this.#executeSelectCommand()
      return
    }

    // slash behaviour execution
    if (v.startsWith('/')) {
      void this.#executeSlashBehaviour()
      return
    }

    // check pluggable behaviors before default handling
    const raw = v.trim()
    for (const behavior of this.#behaviors) {
      // Create a synthetic Enter event for match()
      const synth = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      if (behavior.match(synth, raw)) {
        void Promise.resolve(behavior.execute(raw)).then(() => this.clear())
        return
      }
    }

    // default: create cell
    void this.commitCreateCellInPlace()
  }

  // -------------------------------------------------
  // create cell in place
  // -------------------------------------------------

  private readonly commitCreateCellInPlace = async (): Promise<void> => {
    const rawInput = this.value().trim()
    if (!rawInput) return

    const navigateAfterCreate = rawInput.startsWith('/') || rawInput.endsWith('/')
    const raw = rawInput.replace(/^\/+|\/+$/g, '').trim()

    // support nested cell creation: "hello/world" → create hello, then hello/world
    const parts = raw.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    if (parts.length === 0) {
      this.clear()
      return
    }

    // create the cell directory in OPFS so listCellFolders() can find it
    const dir = await this.lineage.explorerDir()
    if (dir) {
      let parent = dir
      for (const part of parts) {
        parent = await parent.getDirectoryHandle(part, { create: true })
      }
    }

    const armed = this.armedResource()

    if (armed) {
      // Lock substrate out of this cell until the resource is fully attached.
      // The lock is released by ResourceAttachDrone once the props blob is
      // written to OPFS and the tile-props-index is updated.
      EffectBus.emit('cell:attach-pending', { cell: parts[0], pending: true })
    }

    // emit cell:added — HistoryRecorder will record the op
    EffectBus.emit('cell:added', { cell: parts[0] })

    if (armed) {
      EffectBus.emit('cell:attach-resource', {
        cell: parts[0],
        largeSig: armed.largeSig,
        smallPointSig: armed.smallPointSig,
        smallFlatSig: armed.smallFlatSig,
        url: armed.url,
        type: armed.type,
      })
      this.onArmedResourceDismiss()
    }

    this.requestSynchronize()

    if (navigateAfterCreate) {
      const baseSegments = this.navigation.segmentsRaw()
      const target = [...baseSegments, ...parts]
      this.navigation.goRaw(target)
      this.clear()
    } else if (parts.length > 1) {
      // retain parent path so user can keep adding children
      // e.g. "interests/cigars" → leaves "interests/" in the bar
      const prefix = parts.slice(0, -1).map(p => this.completions.render(p, 'space')).join('/')
      this.#setShellValue(prefix + '/', true)
    } else {
      this.clear()
    }
  }

  // -------------------------------------------------
  // slash behaviour execution
  // -------------------------------------------------

  readonly #executeSlashBehaviour = async (): Promise<void> => {
    const raw = this.value().slice(1).trim()
    if (!raw) { this.clear(); return }

    // split on first space or '(' — /move(5) → command 'move', args '(5)'
    const spaceIdx = raw.indexOf(' ')
    const parenIdx = raw.indexOf('(')
    const delimIdx = spaceIdx >= 0 && (parenIdx < 0 || spaceIdx < parenIdx) ? spaceIdx
      : parenIdx >= 0 ? parenIdx
      : -1
    const commandName = delimIdx === -1 ? raw : raw.slice(0, delimIdx)
    const args = delimIdx === -1 ? '' : raw.slice(delimIdx === parenIdx ? delimIdx : delimIdx + 1).trim()

    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as any
    if (drone?.execute) {
      await drone.execute(commandName, args)
    }
    this.clear()
  }

  // -------------------------------------------------
  // /select[...] command execution
  // -------------------------------------------------

  readonly #executeSelectCommand = async (): Promise<void> => {
    const v = this.value().trim()
    const bracketClose = v.indexOf(']')
    if (bracketClose < 0) { return } // brackets not closed yet, no-op

    const inner = v.slice(v.indexOf('[') + 1, bracketClose)
    const labels = inner.split(',').map(s => this.completions.normalize(this.#stripTagSuffix(s.trim()))).filter(Boolean)
    if (labels.length === 0) { this.clear(); return }

    const afterBracket = v.slice(bracketClose + 1)

    // Parse operation: /cut, /copy, /move...
    const opMatch = afterBracket.match(/^\/(\w+)/)
    const op = opMatch ? opMatch[1].toLowerCase() : ''

    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    if (!selection) { this.clear(); return }

    // Always select the tiles first — guard against sync feedback
    this.#syncDirection = 'command'
    selection.clear()
    for (const label of labels) {
      selection.add(label)
    }
    this.#syncDirection = 'idle'

    if (op === 'cut') {
      // Use existing ClipboardWorker via controls:action effect
      EffectBus.emit('controls:action', { action: 'cut' })
      this.clear()
      return
    }

    if (op === 'copy') {
      EffectBus.emit('controls:action', { action: 'copy' })
      this.#collapseToSelect(labels)
      return
    }

    if (op === 'move') {
      // Parse target: (index) or [swapTile]
      const afterOp = afterBracket.slice(opMatch![0].length)

      // Check for (index)
      const indexMatch = afterOp.match(/\((\d+)\)/) || afterOp.match(/\((\d+)$/)
      if (indexMatch) {
        const targetIndex = parseInt(indexMatch[1], 10)
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          // Always restart fresh — labels may have changed since typing started the preview
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
          moveDrone.beginCommandMove([...labels])
          await moveDrone.commitCommandMoveAt(targetIndex)
        }
        this.#lastMoveLabels = []
        this.#collapseToSelect(labels)
        return
      }

      // Check for [swapTile]
      const swapMatch = afterOp.match(/.*\[([^\]]+)\]$/)
      if (swapMatch) {
        const swapLabel = this.completions.normalize(swapMatch[1])
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
          moveDrone.beginCommandMove([...labels])
          await moveDrone.commitCommandMoveToLabel(swapLabel)
        }
        this.#lastMoveLabels = []
        this.#collapseToSelect(labels)
        return
      }

      // Just /move with no target — stay in move mode (don't clear)
      return
    }

    if (op === 'keyword' || op === 'kw' || op === 'tag') {
      const afterOp = afterBracket.slice(opMatch![0].length).trim()
      if (afterOp) {
        const queen = get('@diamondcoreprocessor.com/KeywordQueenBee') as any
        if (queen?.invoke) {
          await queen.invoke(afterOp)
        }
      }
      this.#collapseToSelect(labels)
      return
    }

    if (op === 'remove' || op === 'rm' || op === 'delete' || op === 'del') {
      const lineage = this.lineage
      const dir = await lineage.explorerDir()
      if (dir) {
        for (const label of labels) {
          try {
            await dir.removeEntry(label, { recursive: true })
            EffectBus.emit('cell:removed', { cell: label })
          } catch { /* skip */ }
        }
      }
      selection.clear()
      await new hypercomb().act()
      this.clear()

      // if all cells removed, navigate to parent
      if (dir) {
        let hasCells = false
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory' && !name.startsWith('__')) { hasCells = true; break }
        }
        if (!hasCells) {
          const segments = this.navigation.segmentsRaw()
          if (segments.length > 0) {
            this.navigation.goRaw(segments.slice(0, -1))
          }
        }
      }
      return
    }

    if (op === 'format' || op === 'fmt' || op === 'fp') {
      // Set first selected tile as active so FormatQueenBee reads its properties
      if (labels.length > 0) selection.setActive(labels[0])
      const queen = get('@diamondcoreprocessor.com/FormatQueenBee') as any
      if (queen?.invoke) await queen.invoke('')
      this.#collapseToSelect(labels)
      return
    }

    if (['opus', 'sonnet', 'haiku', 'o', 's', 'h'].includes(op)) {
      const afterOp = afterBracket.slice(opMatch![0].length).trim()
      const queen = get('@diamondcoreprocessor.com/LlmQueenBee') as any
      if (queen) {
        queen.activeModel = op
        await queen.invoke(afterOp)
      }
      this.#collapseToSelect(labels)
      return
    }

    // No operation — just /select[tiles] → select and show in bar
    this.#collapseToSelect(labels)
  }

  /**
   * Universal tag extractor — scans any input string for tag syntax,
   * persists adds/removes to OPFS, and returns the cleaned input.
   *
   * Bracket tag syntax (cell is the label before brackets):
   *   abc[:education, :work]        → add tags to "abc"
   *   abc[~:education, :work]       → remove "education", add "work" to "abc"
   *   abc[:tag(#ff0), 123]          → add tag with color, "123" passes through
   *
   * Plain tag syntax (label:tag — no brackets):
   *   label:tagName                 → add tag
   *   label:tagName(#color)         → add tag with global color
   *   ~label:tagName                → remove tag
   *
   * Inside /select[...] brackets, each comma-separated item is also checked.
   */
  async #extractAndPersistTags(input: string): Promise<string> {
    type TagOp = { label: string; tag: string; color?: string; remove: boolean }
    const ops: TagOp[] = []

    // ── Pattern 1: cell:[tag, ~tag] bracket-tag syntax ──
    // Colon before bracket signals ALL items are tags (no : prefix needed inside).
    // Matches: abc:[education, ~work] or abc:[tag]
    const bracketTagMatch = input.match(BRACKET_TAG_RE)
    if (bracketTagMatch) {
      const label = this.completions.normalize(bracketTagMatch[1].trim())
      const bracketBody = bracketTagMatch[2]
      const suffix = bracketTagMatch[3]
      const items = bracketBody.split(',')

      for (const raw of items) {
        const trimmed = raw.trim()
        if (!trimmed || !label) continue
        // ~tagname → remove tag
        if (trimmed.startsWith('~')) {
          const tag = trimmed.slice(1).trim()
          if (tag) ops.push({ label, tag, remove: true })
        } else {
          // tagname or tagname(#color) → add tag
          const colorMatch = trimmed.match(/^([^(]+)(?:\(([^)]+)\))?$/)
          if (colorMatch) {
            const tag = colorMatch[1].trim()
            const color = colorMatch[2]?.trim()
            if (tag) ops.push({ label, tag, color, remove: false })
          }
        }
      }

      if (ops.length > 0) {
        await this.#persistTagOps(ops)
        // Tag-only bracket — return just the label (for cell creation if needed)
        return label + suffix
      }
      return input
    }

    // ── Pattern 1b: label[...:tag items...] legacy bracket syntax ──
    // Colon prefix inside brackets (e.g. abc[:education, ~:work, 123])
    const labelBracketMatch = input.match(/^([^\[\/!#~]+)\[(.+?)\](.*)$/)
    if (labelBracketMatch) {
      const label = this.completions.normalize(labelBracketMatch[1].trim())
      const bracketBody = labelBracketMatch[2]
      const suffix = labelBracketMatch[3]
      const items = bracketBody.split(',')
      const cleanedItems: string[] = []

      for (const raw of items) {
        const trimmed = raw.trim()
        // ~:tag → remove tag from label
        const removeMatch = trimmed.match(/^~:([^(]+)(?:\(([^)]+)\))?$/)
        if (removeMatch && label) {
          const tag = removeMatch[1].trim()
          if (tag) ops.push({ label, tag, remove: true })
          continue
        }
        // :tag or :tag(#color) → add tag to label
        const addMatch = trimmed.match(/^:([^(]+)(?:\(([^)]+)\))?$/)
        if (addMatch && label) {
          const tag = addMatch[1].trim()
          const color = addMatch[2]?.trim()
          if (tag) ops.push({ label, tag, color, remove: false })
          continue
        }
        // non-tag item — pass through
        cleanedItems.push(raw)
      }

      if (ops.length > 0) {
        await this.#persistTagOps(ops)
        // Rebuild: if only tag items remained, just return the label (cell creation)
        if (cleanedItems.length === 0) return label + suffix
        return label + '[' + cleanedItems.join(',') + ']' + suffix
      }
      return input
    }

    // ── Pattern 2: bracket command syntax (/select[, /format[, etc.) ──
    const normalizedInput = normalizeSelectInput(input)
    const selectMatch = normalizedInput.match(/^(\/select\[)(.+?)(\].*)$/)
    if (selectMatch) {
      const items = selectMatch[2].split(',')
      const cleanedItems: string[] = []

      for (const raw of items) {
        const trimmed = raw.trim()
        const removeMatch = trimmed.match(/^~([^:]+):([^(]+)(?:\(([^)]+)\))?$/)
        const addMatch = trimmed.match(TAG_ASSIGN_RE)

        if (removeMatch) {
          const label = this.completions.normalize(removeMatch[1])
          const tag = removeMatch[2].trim()
          if (label && tag) ops.push({ label, tag, remove: true })
        } else if (addMatch) {
          const label = this.completions.normalize(addMatch[1])
          const tag = addMatch[2].trim()
          const color = addMatch[3]?.trim()
          if (label && tag) {
            ops.push({ label, tag, color, remove: false })
            cleanedItems.push(raw.replace(/:.*$/, ''))
          } else {
            cleanedItems.push(raw)
          }
        } else {
          cleanedItems.push(raw)
        }
      }

      if (ops.length > 0) {
        await this.#persistTagOps(ops)
        const cleaned = selectMatch[1] + cleanedItems.join(',') + selectMatch[3]
        return cleaned.replace(/^\/select\[\s*\].*$/, '').trim()
      }
      return input
    }

    // ── Pattern 3: plain label:tag (no brackets) ──
    const trimmed = input.trim()
    const removeMatch = trimmed.match(/^~([^:]+):([^(]+)(?:\(([^)]+)\))?$/)
    const addMatch = trimmed.match(TAG_ASSIGN_RE)

    if (removeMatch) {
      const label = this.completions.normalize(removeMatch[1])
      const tag = removeMatch[2].trim()
      if (label && tag) {
        ops.push({ label, tag, remove: true })
        await this.#persistTagOps(ops)
        return ''
      }
    } else if (addMatch) {
      const label = this.completions.normalize(addMatch[1])
      const tag = addMatch[2].trim()
      const color = addMatch[3]?.trim()
      if (label && tag) {
        ops.push({ label, tag, color, remove: false })
        await this.#persistTagOps(ops)
        return label // keep the label for cell creation
      }
    }

    return input
  }

  /** Persist tag add/remove operations to OPFS + master registry. */
  async #persistTagOps(ops: TagOp[]): Promise<void> {
    const dir = await this.lineage.explorerDir()
    if (!dir) return
    await persistTagOps(ops, dir)
  }

  /** After an operation completes, collapse the command line to /select[remaining-tiles] */
  #buildSelectValue(labels: readonly string[], truncate: boolean): string {
    if (!truncate) return '/select[' + labels.join(',') + ']'
    const mapped = labels.map(l => l.length <= 4 ? l : l.slice(0, 3) + '.')
    return '/select[' + mapped.join(',') + ']'
  }

  /** Whether to truncate: 4+ items or bracket content > 64 chars, and input is unfocused */
  #shouldTruncate(labels: readonly string[]): boolean {
    if (document.activeElement?.closest('hc-command-shell')) return false
    if (labels.length >= 4) return true
    return labels.join(',').length > 64
  }

  // ── move index helpers ─────────────────────────────────────

  /**
   * When the user types '(' right after /move, auto-insert the active tile's
   * current index so they can immediately scrub with arrow keys.
   * Returns true if the value was modified.
   */
  #autoPopulateMoveIndex(v: string): boolean {
    // Match /move( at the end with nothing after the paren (just typed it)
    if (!v.match(/\/move\($/i)) return false

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { active: string | null; selected: ReadonlySet<string> } | undefined
    const activeLabel = selection?.active
    if (!activeLabel) {
      // No active tile — default to 0
      this.shell?.setValue(v + '0')
      this.value.set(this.shell?.value() ?? '')
      return true
    }

    // Find the index of the active tile
    const cellNames = this.cellNames$()
    const idx = cellNames.indexOf(activeLabel)
    this.shell?.setValue(v + (idx >= 0 ? idx : 0))
    this.value.set(this.shell?.value() ?? '')
    return true
  }

  /** Detect if cursor is inside a /move( parenthesized index — works with or without /select[...] prefix */
  #isInMoveParen(v: string): boolean {
    const moveIdx = v.lastIndexOf('/move')
    if (moveIdx < 0) return false
    const afterMove = v.slice(moveIdx + 5)
    return afterMove.includes('(')
  }

  /** Increment/decrement the numeric index inside /move(N) by `delta` (+1 or -1). */
  #scrubMoveIndex(delta: number): void {
    const v = this.value()
    const parenIdx = v.lastIndexOf('(')
    if (parenIdx < 0) return

    const currentIndex = parseInt(v.slice(parenIdx + 1).replace(/\)$/, ''), 10)
    if (isNaN(currentIndex)) return

    const axialSvc = get('@diamondcoreprocessor.com/AxialService') as any
    if (!axialSvc?.items) return

    const maxIndex = axialSvc.items.size - 1
    const newIndex = Math.max(0, Math.min(currentIndex + delta, maxIndex))

    this.shell?.setValue(v.slice(0, parenIdx + 1) + newIndex)
    this.value.set(this.shell?.value() ?? '')
  }

  /** Scrub the move target index with Ctrl+Arrow using hex offsets. Returns true if handled. */
  #handleMoveScrub(e: KeyboardEvent): boolean {
    const offset = MOVE_ARROW_OFFSETS[e.key]
    if (!offset) return false

    e.preventDefault()

    const v = this.value()
    const parenIdx = v.lastIndexOf('(')
    if (parenIdx < 0) return true

    const raw = v.slice(parenIdx + 1).replace(/\)$/, '')
    const currentIndex = raw === '' ? 0 : parseInt(raw, 10)
    if (isNaN(currentIndex)) return true

    const axialSvc = get('@diamondcoreprocessor.com/AxialService') as any
    if (!axialSvc?.items) return true

    const coord = axialSvc.items.get(currentIndex)
    if (!coord) return true

    // Apply hex offset
    const newQ = coord.q + offset.dq
    const newR = coord.r + offset.dr

    // Find the index at the new axial position
    let newIndex = -1
    for (const [idx, item] of axialSvc.items) {
      if (item.q === newQ && item.r === newR) { newIndex = idx; break }
    }
    if (newIndex < 0) return true // out of bounds

    // Update the shell and sync
    this.shell?.setValue(v.slice(0, parenIdx + 1) + newIndex)
    this.value.set(this.shell?.value() ?? '')
    return true
  }

  #collapseToSelect(labels: readonly string[]): void {
    // Trust the labels parameter — SelectionService may be stale after async operations
    if (labels.length > 0) {
      this.#setShellValue(this.#buildSelectValue([...labels], this.#shouldTruncate(labels)), true)
    } else {
      this.clear()
    }
  }

  /** Cancel select operation — collapse back to /select[tiles] or clear */
  #cancelSelectOperation(): void {
    const phase = this.#selectPhase()
    const labels = this.#selectLabels()
    EffectBus.emit('move:preview', null)

    // Cancel any active command move
    const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
    if (moveDrone?.moveCommandActive) moveDrone.cancelCommandMove()
    this.#lastMoveLabels = []

    // Restore navigation if we navigated away
    if (this.#selectOriginalSegments) {
      this.navigation.replaceRaw(this.#selectOriginalSegments)
      this.#selectOriginalSegments = null
    }

    // If there's an operation after ] (e.g. /select[tiles]/cut), collapse to /select[tiles]
    // Otherwise (selection phase or bare /select[tiles]), clear everything
    const v = this.value()
    const bracketClose = v.indexOf(']')
    const hasOperation = bracketClose >= 0 && v.slice(bracketClose + 1).startsWith('/')
    if (hasOperation && labels.length > 0) {
      this.#collapseToSelect(labels)
    } else {
      this.clear()
    }
  }

  // -------------------------------------------------
  // completion logic
  // -------------------------------------------------

  /** Bridge: shell accepted a suggestion (Tab/ArrowRight/click). */
  public onShellCompletionAccepted = (best: string): void => {
    const ctx = this.context()
    if (!ctx.active) return

    // tag mode: persist tag, then leave label: in input for chaining
    if (ctx.mode === 'tag') {
      const full = ctx.head + best
      const head = ctx.head // e.g. "echo:"
      void this.#extractAndPersistTags(full).then(() => {
        this.#setShellValue(head, false)
      })
      return
    }

    // slash mode: fill command name or command-specific arg completion
    if (ctx.mode === 'slash') {
      if (ctx.head.match(/^\/(remove|rm|delete|del)[\s\[]/i)) {
        this.#setShellValue(ctx.head + best, false)
        return
      }
      // Accent bracket mode: append tag with comma separator, or preset after brackets
      if (ctx.head.match(/^\/(accent|ac)[\s\[]/i)) {
        const inBrackets = ctx.head.includes('[') && !ctx.head.includes(']')
        if (inBrackets) {
          // Inside brackets: append tag, add comma + space for chaining
          this.#setShellValue(ctx.head + best + ', ', false)
        } else {
          // Preset position (after brackets or single arg)
          this.#setShellValue(ctx.head + best, false)
        }
        return
      }
      // If head is just '/', we're completing the command name itself
      // If head is longer (e.g. '/language '), we're completing an argument
      if (ctx.head === '/') {
        this.#setShellValue('/' + best, true)
      } else {
        this.#setShellValue(ctx.head + best, false)
      }
      return
    }

    // select mode: completion depends on phase
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()
      const raw = this.value()

      if (phase === 'selection') {
        const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('['))
        const before = raw.slice(0, lastSep + 1)
        const spacer = raw.lastIndexOf(',') >= 0 ? ' ' : ''
        this.#syncDirection = 'command'
        this.#setShellValue(before + spacer + best, false)
        this.#syncDirection = 'idle'
        return
      }

      if (phase === 'operation') {
        const bracketClose = raw.indexOf(']')
        const prefix = raw.slice(0, bracketClose + 1)
        const op = best.startsWith('/') ? best : '/' + best
        this.#setShellValue(prefix + op, true)
        return
      }

      if (phase === 'move-path') {
        this.#setShellValue(ctx.head + best + '/', false)
        return
      }

      if (phase === 'move-target-swap') {
        this.#setShellValue(ctx.head + best + ']', true)
        return
      }

      return
    }

    const bracketPhase = this.#bracketPhase()
    const subPath = this.cellSubPath()
    const raw = this.value()

    // bracket-items mode: insert name after last comma (or after [)
    if (bracketPhase === 'items') {
      const leaf = this.cellLeaf()
      const lastComma = raw.lastIndexOf(',')
      const insertAt = lastComma >= 0 ? lastComma + 1 : raw.indexOf('[') + 1
      const before = raw.slice(0, insertAt)
      const spacer = lastComma >= 0 ? ' ' : ''
      const isTagLeaf = leaf.startsWith(':') || leaf.startsWith('~:')
      if (isTagLeaf && this.#colonBracketMode) {
        const removePrefix = leaf.startsWith('~:') ? '~' : ''
        this.#setShellValue(before + spacer + removePrefix + best, false)
      } else if (isTagLeaf) {
        const tagPrefix = leaf.startsWith('~:') ? '~:' : ':'
        this.#setShellValue(before + spacer + tagPrefix + best, false)
      } else {
        this.#setShellValue(before + spacer + best, false)
      }
      this.updateCellSubPath()
      return
    }

    // bracket-path mode: rebuild bracket prefix + path with accepted child
    if (bracketPhase === 'path') {
      const bracketClose = raw.indexOf(']')
      const bracketPrefix = raw.slice(0, bracketClose + 2)
      if (subPath.length > 0) {
        this.#setShellValue(bracketPrefix + subPath.join('/') + '/' + best + '/', false)
      } else {
        this.#setShellValue(bracketPrefix + best + '/', false)
      }
      this.updateCellSubPath()
      return
    }

    // sub-path mode: rebuild the full path with the accepted child name
    if (subPath.length > 0) {
      const pathPrefix = subPath.join('/') + '/'
      this.#setShellValue(pathPrefix + best + '/', false)
      this.updateCellSubPath()
      return
    }

    const rendered = this.completions.render(best, ctx.style)
    const newValue = (ctx.mode === 'marker' || ctx.mode === 'remove')
      ? ctx.head + rendered
      : rendered

    this.#setShellValue(newValue, true)
  }

  // -------------------------------------------------
  // ui helpers (delegated to shell)
  // -------------------------------------------------

  /** Set shell value and sync local state. */
  #setShellValue(v: string, suppress: boolean): void {
    if (!this.shell) return
    this.shell.setValue(v)
    this.value.set(v)
    if (suppress) this.shell.suppress()
    else this.shell.unsuppress()
    this.shell.placeCaretAtEnd()
  }

  private readonly clear = (): void => {
    this.shell?.clear()
    this.value.set('')
    this.cellSubPath.set([])
    this.cellLeaf.set('')
    this.cellProvider.query([])
    if (this.lastFilterKeyword) {
      EffectBus.emit('search:filter', { keyword: '' })
      this.lastFilterKeyword = ''
    }
    // Clear selection when exiting select mode
    if (this.#lastSelectMode) {
      this.#syncDirection = 'command'
      const selection = get('@diamondcoreprocessor.com/SelectionService') as any
      if (selection?.count > 0) selection.clear()
      this.#syncDirection = 'idle'
      this.#lastSelectMode = false
    }
    // Cancel any active command move
    const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
    if (moveDrone?.moveCommandActive) moveDrone.cancelCommandMove()
    this.#lastMoveLabels = []
    // Reset select state (phase/labels/excluded are computed from value, auto-reset)
    if (this.#selectOriginalSegments) {
      this.navigation.replaceRaw(this.#selectOriginalSegments)
      this.#selectOriginalSegments = null
    }
  }

  private readonly requestSynchronize = (): void => {
    void new hypercomb().act()
  }

  // -------------------------------------------------
  // /select[...] context parsing
  // -------------------------------------------------

  /** Original navigation segments stored before real-time navigation (for rollback) */
  #selectOriginalSegments: string[] | null = null

  /** Labels last passed to beginCommandMove — detect changes and restart */
  #lastMoveLabels: readonly string[] = []

  /** Phase derived from value — computed, no signal writes */
  #selectPhase = computed<'none' | 'selection' | 'operation' | 'move-path' | 'move-target-index' | 'move-target-swap'>(() => {
    const v = this.value()
    if (!isSelectInput(v)) return 'none'
    return this.#deriveSelectPhase(normalizeSelectInput(v))
  })

  /** Strip :tag(color) suffix from a raw select item, returning just the tile label. */
  #stripTagSuffix(raw: string): string {
    const colon = raw.indexOf(':')
    return colon >= 0 ? raw.slice(0, colon) : raw
  }

  /** Labels derived from value — computed. During selection phase, only includes
   *  committed labels (before last comma) + the current partial IFF it exactly matches a cell name. */
  #selectLabels = computed<readonly string[]>(() => {
    const v = normalizeSelectInput(this.value())
    if (!v.match(/^\/select\[/)) return []
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')
    // Bracket closed — parse full list
    if (bracketClose >= 0) {
      const inner = v.slice(bracketOpen + 1, bracketClose)
      return inner.split(',').map(s => this.completions.normalize(this.#stripTagSuffix(s.trim()))).filter(Boolean)
    }
    // Bracket still open (selection phase) — committed labels (before last comma)
    // plus current partial only if it exactly matches a known cell name
    const body = v.slice(bracketOpen + 1)
    const allParts = body.split(',').map(s => this.completions.normalize(this.#stripTagSuffix(s.trim()))).filter(Boolean)
    if (allParts.length === 0) return []
    const committed = allParts.slice(0, -1)
    const partial = allParts[allParts.length - 1]
    const cells = new Set(this.cellNames$())
    if (cells.has(partial)) return allParts
    return committed
  })


  /** Excluded items derived from value — computed */
  #selectExcluded = computed<ReadonlySet<string>>(() => {
    const v = normalizeSelectInput(this.value())
    if (!v.match(/^\/select\[/)) return new Set<string>()
    const bracketClose = v.indexOf(']')
    if (bracketClose >= 0) return new Set<string>() // brackets closed, no exclusion needed
    const body = v.slice(v.indexOf('[') + 1)
    const lastComma = body.lastIndexOf(',')
    if (lastComma < 0) return new Set<string>()
    const already = new Set<string>()
    for (const item of body.slice(0, lastComma).split(',')) {
      const n = this.completions.normalize(this.#stripTagSuffix(item.trim()))
      if (n) already.add(n)
    }
    return already
  })

  /** Derive the select phase from the input string (pure, no side effects) */
  #deriveSelectPhase(v: string): 'selection' | 'operation' | 'move-path' | 'move-target-index' | 'move-target-swap' {
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')

    if (bracketClose < 0) return 'selection'

    const afterBracket = v.slice(bracketClose + 1)
    if (!afterBracket || afterBracket === '/') return 'operation'

    if (afterBracket.startsWith('/')) {
      const opAndRest = afterBracket.slice(1)
      const nextSlash = opAndRest.indexOf('/')
      const opKeyword = nextSlash === -1 ? opAndRest : opAndRest.slice(0, nextSlash)
      const opLower = opKeyword.toLowerCase().trim()

      if (opLower === 'cut' || opLower === 'copy' || opLower === 'remove' || opLower === 'rm' || opLower === 'format' || opLower === 'fmt' || opLower === 'fp' || opLower === 'opus' || opLower === 'sonnet' || opLower === 'haiku' || opLower === 'o' || opLower === 's' || opLower === 'h') return 'operation'

      if (opLower === 'move' || opLower.startsWith('move')) {
        // Check for (index) — note: the first [ is at bracketOpen
        const parenIdx = v.lastIndexOf('(')
        if (parenIdx > bracketClose) return 'move-target-index'

        const lastBracketOpen = v.lastIndexOf('[')
        if (lastBracketOpen > bracketClose) return 'move-target-swap'

        const afterMove = nextSlash === -1 ? '' : opAndRest.slice(nextSlash)
        if (afterMove) return 'move-path'

        return 'operation'
      }

      return 'operation'
    }

    return 'operation'
  }

  #parseSelectContext(v: string): import('@hypercomb/shared/core/completion-utility').CompletionContext {
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')
    const phase = this.#deriveSelectPhase(v)

    // Phase: selection — inside the first bracket pair
    if (phase === 'selection') {
      const body = v.slice(bracketOpen + 1)
      const lastSep = Math.max(body.lastIndexOf(','), -1)
      const raw = lastSep === -1 ? body : body.slice(lastSep + 1).trimStart()
      const head = v.slice(0, v.length - raw.length)
      const normalized = this.completions.normalize(raw)

      return {
        active: true,
        mode: 'select',
        head,
        raw,
        normalized,
        style: 'space'
      }
    }

    const afterBracket = v.slice(bracketClose + 1)

    // Phase: operation keyword
    if (phase === 'operation') {
      if (!afterBracket || afterBracket === '/') {
        const raw = afterBracket.startsWith('/') ? afterBracket.slice(1) : ''
        return {
          active: true,
          mode: 'select',
          head: v.slice(0, v.length - raw.length),
          raw,
          normalized: raw.toLowerCase().trim(),
          style: 'space'
        }
      }
      if (afterBracket.startsWith('/')) {
        const opAndRest = afterBracket.slice(1)
        const nextSlash = opAndRest.indexOf('/')
        const opKeyword = nextSlash === -1 ? opAndRest : opAndRest.slice(0, nextSlash)
        const opLower = opKeyword.toLowerCase().trim()

        if (opLower === 'cut' || opLower === 'copy' || opLower === 'move' || opLower === 'format' || opLower === 'fmt' || opLower === 'fp' || opLower === 'opus' || opLower === 'sonnet' || opLower === 'haiku' || opLower === 'o' || opLower === 's' || opLower === 'h') {
          return { active: true, mode: 'select', head: v, raw: '', normalized: opLower, style: 'space' }
        }
        return {
          active: true, mode: 'select',
          head: v.slice(0, bracketClose + 2),
          raw: opKeyword, normalized: opLower, style: 'space'
        }
      }
      return { active: true, mode: 'select', head: v, raw: '', normalized: '', style: 'space' }
    }

    // Phase: move-target-index
    if (phase === 'move-target-index') {
      const parenStart = v.lastIndexOf('(')
      const raw = v.slice(parenStart + 1).replace(/\)$/, '')
      return { active: true, mode: 'select', head: v.slice(0, parenStart + 1), raw, normalized: raw.trim(), style: 'space' }
    }

    // Phase: move-target-swap
    if (phase === 'move-target-swap') {
      const lastBracketOpen = v.lastIndexOf('[')
      const raw = v.slice(lastBracketOpen + 1).replace(/\]$/, '')
      return { active: true, mode: 'select', head: v.slice(0, lastBracketOpen + 1), raw, normalized: this.completions.normalize(raw), style: 'space' }
    }

    // Phase: move-path
    if (phase === 'move-path') {
      const opAndRest = afterBracket.slice(1)
      const nextSlash = opAndRest.indexOf('/')
      const afterMove = nextSlash === -1 ? '' : opAndRest.slice(nextSlash)
      const pathPart = afterMove.slice(1)
      const pathSlash = pathPart.lastIndexOf('/')
      const raw = pathSlash === -1 ? pathPart : pathPart.slice(pathSlash + 1)
      return { active: true, mode: 'select', head: v.slice(0, v.length - raw.length), raw, normalized: this.completions.normalize(raw), style: 'space' }
    }

    return { active: true, mode: 'select', head: v, raw: '', normalized: '', style: 'space' }
  }

  /** Sync direction flag to prevent feedback loops in bi-directional sync */
  #syncDirection: 'command' | 'visual' | 'idle' = 'idle'
  /** Tracks whether we were in select mode last input — used to detect exit and clear selection */
  #lastSelectMode = false

  /**
   * Handle side effects when typing in /select[...] mode:
   * - Show/hide index overlay when entering/leaving move phases
   * - Emit move preview when target index changes
   * - Navigate in real-time when path changes
   */
  #handleSelectInputEffects(): void {
    const phase = this.#selectPhase()
    const labels = this.#selectLabels()

    // Select tiles visually as labels are typed — bidirectional sync.
    // Keep #syncDirection = 'command' for the entire method so that
    // synchronous side-effects (move:preview → render:cell-count →
    // selection:changed) don't feed back and overwrite the input.
    this.#syncDirection = 'command'
    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    if (selection) {
      const current = selection.selected as ReadonlySet<string>
      const target = new Set(labels)
      // Only update if different
      if (current.size !== target.size || ![...target].every(l => current.has(l))) {
        selection.clear()
        for (const label of labels) selection.add(label)
      }
    }

    // Live preview when target index is being typed
    if (phase === 'move-target-index') {
      const v = this.value()
      const parenStart = v.lastIndexOf('(')
      const rawIndex = v.slice(parenStart + 1).replace(/\)$/, '')
      const targetIndex = parseInt(rawIndex, 10)
      if (!isNaN(targetIndex) && labels.length > 0) {
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          // Detect label changes — restart command move with fresh occupancy
          const labelsChanged = labels.length !== this.#lastMoveLabels.length
            || labels.some((l, i) => l !== this.#lastMoveLabels[i])
          if (!moveDrone.moveCommandActive || labelsChanged) {
            if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
            moveDrone.beginCommandMove([...labels])
            this.#lastMoveLabels = labels
          }
          moveDrone.updateCommandMove(targetIndex)
        }
      }
    } else {
      // Clear preview when not in target-index phase
      const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
      if (moveDrone?.moveCommandActive) {
        moveDrone.cancelCommandMove()
        this.#lastMoveLabels = []
      }
    }

    // Real-time navigation when in move-path phase
    if (phase === 'move-path') {
      const v = this.value()
      const moveStart = v.indexOf('/move')
      if (moveStart >= 0) {
        const afterMove = v.slice(moveStart + 5) // after /move
        if (afterMove.startsWith('/')) {
          const pathPart = afterMove.slice(1).replace(/\/$/, '')
          if (pathPart) {
            const segments = pathPart.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
            // Store original navigation state for rollback
            if (!this.#selectOriginalSegments) {
              this.#selectOriginalSegments = [...this.navigation.segmentsRaw()]
            }
            // Navigate to target directory
            const target = [...this.#selectOriginalSegments, ...segments]
            this.navigation.replaceRaw(target)
            // Update cell suggestion provider for autocomplete at target
            this.cellProvider.query(segments)
          }
        }
      }
    }

    this.#syncDirection = 'idle'
  }

  // -------------------------------------------------
  // cell sub-path tracking
  // -------------------------------------------------

  // bracket mode: 'none' | 'items' (inside []) | 'path' (after ]/)
  #bracketPhase = signal<'none' | 'items' | 'path'>('none')
  /** Whether current bracket mode is colon-bracket (cell:[...]) — items are plain tag names. */
  #colonBracketMode = false
  /** Pending tag adds/removes typed in the current bracket input (not yet persisted). */
  #bracketPendingTags: { adds: Set<string>; removes: Set<string> } = { adds: new Set(), removes: new Set() }

  /** Load a cell's existing tags from OPFS into the cache signal. */
  async #loadCellTags(label: string): Promise<void> {
    try {
      const dir = await this.lineage.explorerDir()
      if (!dir) { this.#bracketCellTags.set(new Set()); return }
      const cellDir = await dir.getDirectoryHandle(label, { create: false })
      const props = await readTagProps(cellDir)
      const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []
      this.#bracketCellTags.set(new Set(tags))
    } catch {
      this.#bracketCellTags.set(new Set())
    }
  }

  /** Parse tag items in cell:[...] syntax (no : prefix — items are plain names, ~ for removal). */
  #parseBracketTagItems(inner: string): { adds: Set<string>; removes: Set<string> } {
    const adds = new Set<string>()
    const removes = new Set<string>()
    for (const raw of inner.split(',')) {
      const t = raw.trim()
      if (t.startsWith('~')) { removes.add(t.slice(1).trim()); continue }
      if (t) { adds.add(t); continue }
    }
    return { adds, removes }
  }

  /** Parse :tag and ~:tag items already typed in the bracket body (legacy syntax). */
  #parsePendingBracketTags(inner: string): { adds: Set<string>; removes: Set<string> } {
    const adds = new Set<string>()
    const removes = new Set<string>()
    for (const raw of inner.split(',')) {
      const t = raw.trim()
      const rm = t.match(/^~:(\S+)/)
      if (rm) { removes.add(rm[1]); continue }
      const add = t.match(/^:([^(]\S*)/)
      if (add) { adds.add(add[1]); continue }
    }
    return { adds, removes }
  }

  private readonly updateCellSubPath = (): void => {
    const raw = this.value().trim()

    // detect bracket mode: [items]/path
    const bracketOpen = raw.indexOf('[')
    const bracketClose = raw.indexOf(']')

    if (bracketOpen >= 0 && bracketClose < 0) {
      // inside brackets — suggest current surface tiles or tags
      this.#bracketPhase.set('items')
      const inner = raw.slice(bracketOpen + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trim() : inner.trim()

      // Detect cell:[...] colon-bracket tag mode: colon immediately before '['
      const isColonBracket = bracketOpen > 0 && raw[bracketOpen - 1] === ':'

      if (isColonBracket) {
        // ALL items in cell:[...] are tags — no : prefix needed
        this.#colonBracketMode = true
        const label = this.completions.normalize(raw.slice(0, bracketOpen - 1).trim())
        if (label && label !== this.#bracketCellLabel) {
          this.#bracketCellLabel = label
          void this.#loadCellTags(label)
        }
        // gather committed tags (before last comma)
        const lastCommaIdx = inner.lastIndexOf(',')
        const committed = lastCommaIdx >= 0 ? inner.slice(0, lastCommaIdx) : ''
        this.#bracketPendingTags = this.#parseBracketTagItems(committed)
        this.cellSubPath.set([])
        // Use ~ prefix to signal removal mode, otherwise raw fragment for add mode
        this.cellLeaf.set(fragment.startsWith('~') ? '~:' + fragment.slice(1) : ':' + fragment)
        this.cellProvider.query([])
        return
      }

      // Legacy colon-prefixed fragment → tag mode (e.g. abc[:tag])
      this.#colonBracketMode = false
      if (fragment.startsWith(':') || fragment.startsWith('~:')) {
        const label = bracketOpen > 0
          ? this.completions.normalize(raw.slice(0, bracketOpen).trim())
          : ''
        if (label && label !== this.#bracketCellLabel) {
          this.#bracketCellLabel = label
          void this.#loadCellTags(label)
        }
        const lastCommaIdx = inner.lastIndexOf(',')
        const committed = lastCommaIdx >= 0 ? inner.slice(0, lastCommaIdx) : ''
        this.#bracketPendingTags = this.#parsePendingBracketTags(committed)
        this.cellSubPath.set([])
        this.cellLeaf.set(fragment)
        this.cellProvider.query([])
        return
      }
      // clear tag context when not in tag mode
      if (this.#bracketCellLabel) {
        this.#bracketCellLabel = ''
        this.#bracketCellTags.set(new Set())
        this.#bracketPendingTags = { adds: new Set(), removes: new Set() }
      }
      const leaf = this.completions.normalize(fragment)
      this.cellSubPath.set([])
      this.cellLeaf.set(leaf)
      this.cellProvider.query([])
      return
    }

    if (bracketOpen === 0 && bracketClose > 0 && bracketClose < raw.length - 1 && raw[bracketClose + 1] === '/') {
      // after bracket-path — suggest relative subfolders
      this.#bracketPhase.set('path')
      const pathPart = raw.slice(bracketClose + 2) // after ]/
      const clean = pathPart.replace(/\/+$/, '')
      if (!clean.includes('/')) {
        // single level: leaf is the typed fragment, query at current level
        const leaf = this.completions.normalize(clean)
        this.cellSubPath.set([])
        this.cellLeaf.set(leaf)
        this.cellProvider.query([])
        return
      }
      const parts = clean.split('/')
      const leaf = this.completions.normalize((parts.pop() ?? '').trim())
      const subPath = parts.map(p => this.completions.normalize(p.trim())).filter(Boolean)
      this.cellSubPath.set(subPath)
      this.cellLeaf.set(leaf)
      this.cellProvider.query(subPath)
      return
    }

    // default: no bracket mode
    this.#bracketPhase.set('none')

    // strip leading '/' (create-goto prefix)
    const clean = raw.replace(/^\/+/, '')

    // no '/' means we're at the current level
    if (!clean.includes('/')) {
      this.cellSubPath.set([])
      this.cellLeaf.set('')
      this.cellProvider.query([])
      return
    }

    // split on '/' — everything before the last segment is the sub-path,
    // the last segment (possibly empty after trailing '/') is the leaf filter
    const parts = clean.split('/')
    const leaf = this.completions.normalize((parts.pop() ?? '').trim())
    const subPath = parts.map(p => this.completions.normalize(p.trim())).filter(Boolean)

    this.cellSubPath.set(subPath)
    this.cellLeaf.set(leaf)
    this.cellProvider.query(subPath)
  }
}

// Tag props helpers now imported from @hypercomb/shared/core/tag-ops