// hypercomb-shared/ui/command-line/command-line.component.ts

import { AfterViewInit, Component, computed, effect, signal, ViewChild, type OnDestroy } from '@angular/core'
import { CommandShellComponent } from '../command-shell/command-shell.component'
import { HintBarComponent } from '../hint-bar/hint-bar.component'
import { PinnedEntrancesComponent } from '../pinned-entrances/pinned-entrances.component'
import type { Lineage } from '../../core/lineage'
import type { MovementService } from '../../core/movement.service'
import type { Navigation } from '../../core/navigation'
import type { ScriptPreloader } from '../../core/script-preloader'
import type { CellSuggestionProvider } from '../../core/cell-suggestion.provider'
import type { CompletionUtility, CompletionContext } from '@hypercomb/shared/core/completion-utility'
import { fromRuntime } from '../../core/from-runtime'
// Folder-based tag persistence retired. TagOp type is local-only now.
type TagOp = { label: string; tag: string; color?: string; remove: boolean }
import {
  EffectBus, hypercomb, type I18nProvider,
  commandRoot, completeCommandPath, commandMembersFor, commandPath, type CommandObject,
} from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { VoiceInputService } from '../../core/voice-input.service'
import type { CommandLineBehavior, CommandLineBehaviorMeta, CommandLineOperation } from './command-line-behavior'
import { ShiftEnterNavigateBehavior } from './shift-enter-navigate.behavior'
import { BracketBehavior } from './bracket.behavior'
import { PasteUrlNavigateBehavior } from './paste-url-navigate.behavior'
import { RemoveCellBehavior } from './remove-cell.behavior'
import { GoParentBehavior } from './go-parent.behavior'
import { CutPasteBehavior } from './cut-paste.behavior'
import { HashMarkerBehavior } from './hash-marker.behavior'
import { SlashBehaviourBehavior } from './slash-behaviour.behavior'
import { isSelectOp } from './select-ops'
import { parseTargetedKeywordsInput } from '../../core/targeted-keywords-input'

const BUILTIN_SLASH: { behaviour: { name: string; description: string; descriptionKey: string }; provider: null }[] = [
  { behaviour: { name: 'remove', description: 'remove selected tiles', descriptionKey: 'slash.remove-builtin' }, provider: null },
]

/** Threshold between a tap and a long-press on the mobile mic button (ms). */
// Tap-vs-hold boundary for the mobile mic. Generous on purpose: a relaxed
// thumb tap routinely exceeds 300ms, and misreading a tap as a hold turns
// toggle-listening into an instant start/stop that discards the dictation.
const MIC_LONG_PRESS_MS = 450

/** How long the lock indicator stays lit after a pan/zoom-while-locked attempt. */
const LOCKED_FLASH_MS = 1100

/** Matches label:tagName or label:tagName(#color) (plain colon syntax, no brackets). */
const TAG_ASSIGN_RE = /^([^:]+):([^(]+)(?:\(([^)]+)\))?$/

/** Matches cell:[...] bracket-tag syntax — colon before opening bracket. */
const BRACKET_TAG_RE = /^([^\[\/!#~]+):\[(.+?)\](.*)$/

/**
 * `@` attaches a FEATURE (a registered behavior) to a cell — the action/
 * behavior sibling of `:` tags. `abc@gallery` adds the gallery feature to
 * `abc`; `~abc@gallery` detaches it. The feature vocabulary is the live
 * VisualBeeRegistry (every behavior is named + described), so intellisense
 * lists real, attachable behaviors with their descriptions. The target may
 * not contain another sigil (`@ : [ / ! # ~`) or whitespace, so genuine URL
 * / email pastes don't get hijacked — and commit only consumes the input
 * when the fragment resolves to a registered behavior.
 */
const FEATURE_RE = /^([^@:\[\/!#~\s]+)@([^@]*)$/
const FEATURE_REMOVE_RE = /^~([^@:\[\/!#~\s]+)@([^@]*)$/

/**
 * Brackets `[…]` are THE selection grouping primitive — the one canonical form.
 * `[a,b]` selects; `[a,b]/cut` selects then cuts; `~[a,b]` removes; `[a,b]:tag`
 * tags. Legacy `/select[…]`, `/format[…]`, `/fmt[…]`, `/fp[…]` are still accepted
 * as INPUT (old URLs, muscle memory) but are rewritten to the bare bracket and
 * are never echoed or suggested back.
 */
const BRACKET_CMD_RE = /^\/(select|format|fmt|fp)\[/i
/** Normalise any selection-input form to the canonical bare-bracket `[…]`. */
function normalizeSelectInput(v: string): string {
  // Already canonical.
  if (v.startsWith('[')) return v

  // Legacy `/select[…]` → drop the prefix, keep the bracket + any tail.
  const sel = v.match(/^\/select(\[.*)$/i)
  if (sel) return sel[1]

  // Legacy `/format[…]` | `/fmt[…]` | `/fp[…]` → `[items]/format`.
  const m = v.match(/^\/(format|fmt|fp)\[/i)
  if (!m) return v
  const rest = v.slice(m[0].length) // everything after the opening bracket
  const bracketClose = rest.indexOf(']')
  if (bracketClose < 0) return '[' + rest // bracket still open
  return '[' + rest.slice(0, bracketClose) + ']/format' + rest.slice(bracketClose + 1)
}

/** Any `[`-prefixed (or legacy `/select[` / `/format[`) input is a select context. */
function isSelectInput(v: string): boolean {
  if (v.startsWith('[')) {
    const close = v.indexOf(']')
    return close !== 1 // reject the degenerate `[]`
  }
  return BRACKET_CMD_RE.test(v)
}

/** True when the input should EXECUTE on Enter through the bracket dispatcher
 *  (vs. a bare `[a,b]` selection routed to BracketBehavior). */
function isSelectExecution(v: string): boolean {
  if (/^\/select\[/i.test(v)) return true
  if (!v.startsWith('[')) return BRACKET_CMD_RE.test(v)
  const close = v.indexOf(']')
  if (close <= 1) return false
  // Bare `[a,b]` (closed, no op) — BracketBehavior owns the Enter. `:tag`
  // executes here. A trailing `/op` executes here ONLY when op is a known
  // select op — anything else is a cut-paste destination (`[items]/dest`,
  // CutPasteBehavior). Consuming every `/xxx` here silently ate cut-paste:
  // the dispatcher found no known op and collapsed to a bare select.
  if (v[close + 1] === ':') return true
  if (v[close + 1] !== '/') return false
  const m = v.slice(close + 2).match(/^(\w+)/)
  return !!m && isSelectOp(m[1])
}

/** Slash commands that DESTROY — never fired from a completion Enter accepted
 *  on the user's behalf; those complete the line and wait for a second Enter. */
const DESTRUCTIVE_SLASH_RE = /^\/(remove|rm|delete|del)[\s\[]/i

const MOVE_ARROW_OFFSETS: Record<string, { dq: number; dr: number }> = {
  ArrowLeft:  { dq: -1, dr:  0 },
  ArrowRight: { dq:  1, dr:  0 },
  ArrowUp:    { dq:  0, dr: -1 },
  ArrowDown:  { dq:  0, dr:  1 },
}

/** Local recall of executed lines — per-device convenience, never hive state. */
const COMMAND_HISTORY_KEY = 'hc:command-history'
const COMMAND_HISTORY_MAX = 100

function loadCommandHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COMMAND_HISTORY_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

@Component({
  selector: 'hc-command-line',
  standalone: true,
  imports: [CommandShellComponent, HintBarComponent, TranslatePipe, PinnedEntrancesComponent],
  templateUrl: './command-line.component.html',
  styleUrls: ['./command-line.component.scss'],
  host: {
    '[class.mobile-hidden]': 'mobileHidden()',
    '[class.note-intent]': 'noteIntent()',
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

  /**
   * Where the input is pointing, DERIVED from `value()` — never assigned.
   *
   * These used to be imperative signals refreshed by a `updateCellSubPath()`
   * call that only three of the ~dozen paths that mutate the value remembered
   * to make. Every other path (Escape peel-back, slash auto-params, move
   * scrub, history recall, every completion accept) left them describing the
   * PREVIOUS input — and both the ghost text and the Tab accept handler read
   * them to decide how to rebuild the line. A stale sub-path is what turned
   * Tab into "replace the whole line with one name": the accept handler saw
   * `subPath: []`, took the root-level branch, and threw the typed path away.
   * Deriving them makes that class of bug unrepresentable.
   */
  private readonly cellSubPath = computed<readonly string[]>(() => this.#pathContext().subPath)
  private readonly cellLeaf = computed<string>(() => this.#pathContext().leaf)
  /**
   * When set, the command line is in plain text-capture mode and ignores
   * all normal parsing (slash, filter, tag, bracket, create). Enter emits
   * the configured commit effect; Escape cancels.
   *
   * `extra` carries through whatever the requester needs to round-trip
   * with the commit (e.g. an `editId` so the note service replaces in
   * place rather than appending).
   */
  readonly #captureMode = signal<{
    commitEffect: string
    target: string
    placeholderKey: string
    extra: Record<string, unknown>
  } | null>(null)

  /** Public marker — the host binds `.note-intent` to this to glow gold while capturing a note. */
  public readonly noteIntent = computed<boolean>(() => {
    const cap = this.#captureMode()
    return !!cap && cap.commitEffect === 'note:commit'
  })
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

  /**
   * Feature behaviours matching the current `@` fragment, sourced live from
   * the VisualBeeRegistry — every registered behavior is a named, described,
   * attachable feature. Each carries its toggle icon and a localized
   * description so the intellisense reads as self-documenting. Ranking is
   * alpha for now; overlap-count ranking (the one metric we keep) lands with
   * the shared ranking pass.
   */
  readonly #featureMatches = computed<readonly { view: string; icon: string; description: string; slashCommand: string; count: number }[]>(() => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'feature') return []
    const registry = get('@diamondcoreprocessor.com/VisualBeeRegistry') as {
      all(): readonly { view: string; toggleIcon?: string; slashCommand?: string; descriptionKey?: string; labelKey?: string; decorationKind?: string }[]
    } | undefined
    const bees = registry?.all() ?? []
    const metrics = get('@diamondcoreprocessor.com/OverlapMetrics') as { kindCount(kind: string): number } | undefined
    const i18n = this.#i18n
    const q = ctx.normalized
    const mapped = bees.map(b => ({
      view: b.view,
      icon: b.toggleIcon ?? '',
      slashCommand: b.slashCommand ?? '',
      description:
        (b.descriptionKey ? i18n?.t(b.descriptionKey) : undefined) ??
        (b.labelKey ? i18n?.t(b.labelKey) : undefined) ??
        b.view,
      // Overlap count = how many tiles share this feature (the popularity metric).
      count: metrics?.kindCount(b.decorationKind ?? '') ?? 0,
    }))
    if (!mapped.some(item => item.view === 'keywords')) {
      mapped.push({
        view: 'keywords',
        icon: 'sell',
        slashCommand: '/keywords',
        description: 'Generate transcript keywords with Haiku in the background, then review what gets added',
        count: 0,
      })
    }
    const filtered = q ? mapped.filter(m => m.view.toLowerCase().startsWith(q)) : mapped
    // Most-shared first; alpha breaks ties so order is stable.
    return [...filtered].sort((a, b) => b.count - a.count || a.view.localeCompare(b.view))
  })

  /**
   * Descriptions shown right-aligned in the dropdown, keyed by suggestion.
   * Unified across the description-bearing modes (slash behaviours + `@`
   * features) so the shell stays presentational and one binding covers both.
   */
  readonly descriptionMap = computed<ReadonlyMap<string, string>>(() => {
    const ctx = this.context()
    // A member describes itself, in the same breath as its swatch — so the
    // right-hand column needs no per-mode source once an object is walked.
    const active = this.#activeRoot()
    if (active) {
      const map = new Map<string, string>()
      for (const [key, member] of commandMembersFor(active.root, active.args)) {
        if (member.description) map.set(key, member.description)
      }
      if (map.size) return map
    }
    if (ctx.active && ctx.mode === 'slash') return this.slashDescriptionMap()
    if (ctx.active && ctx.mode === 'feature') {
      const map = new Map<string, string>()
      for (const f of this.#featureMatches()) map.set(f.view, f.description)
      return map
    }
    return new Map()
  })

  /**
   * Detail for the highlighted suggestion — drives the right-hand intellisense
   * pane. Returns null for info-less rows (bare cell-create) so the dropdown
   * stays a clean single column there, and a rich record for behaviours /
   * features where there's something worth reading. Reads the shell's active
   * index so arrowing up/down re-renders the pane live (same pattern as
   * {@link ghostValue}). `count` (the overlap metric) is wired through and
   * fills in once the shared ranking pass lands.
   */
  readonly activeDetail = computed<{
    name: string; kind?: string; description?: string; icon?: string; count?: number; options?: readonly string[]
  } | null>(() => {
    if (this.shell?.suppressed()) return null
    const ctx = this.context()
    if (!ctx.active) return null
    const list = this.suggestions()
    if (!list.length) return null
    const idx = this.shell?.activeIndex() ?? 0
    const name = list[Math.max(0, Math.min(idx, list.length - 1))]
    if (!name) return null

    // An OBJECT is being walked: the pane shows what is INSIDE the highlighted
    // member — its own members — so you can see what you are about to walk into
    // before you commit to it. This is the same question the dropdown answers
    // one level up, asked one level down, which is the whole point of the shape:
    // no per-mode code decides what "inside" means.
    const active = this.#activeRoot()
    if (active) {
      const member = commandMembersFor(active.root, active.args).get(name)
      const path = commandPath(name)
      const inside = member?.leaf ? [] : active.root.members(path).map(m => m.name)
      return {
        name: path[path.length - 1] ?? name,
        kind: path.length > 1 ? 'member' : 'object',
        description: member?.description,
        icon: member?.icon ?? (member?.leaf ? 'tune' : 'category'),
        options: inside.length ? inside : undefined,
      }
    }

    // '@' feature — name + localized description + behavior icon + overlap count.
    if (ctx.mode === 'feature') {
      const f = this.#featureMatches().find(m => m.view === name)
      return { name, kind: 'feature', description: f?.description, icon: f?.icon || 'extension', count: f?.count }
    }

    // ':' tag — show how many tiles share it (the overlap/popularity metric).
    if (ctx.mode === 'tag') {
      const metrics = get('@diamondcoreprocessor.com/OverlapMetrics') as { tagCount(name: string): number } | undefined
      return { name, kind: 'tag', icon: 'sell', count: metrics?.tagCount(name) }
    }

    // '/' slash — distinguish choosing the BEHAVIOUR (show its description +
    // its own completions as the "options" cascade) from typing its ARGS.
    if (ctx.mode === 'slash') {
      const isArgMode = /^\/\S+?[\s\[]/i.test(ctx.head)
      if (isArgMode) return { name, kind: 'option', icon: 'tune' }
      const description = this.slashDescriptionMap().get(name)
      const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
        { complete?(behaviourName: string, args: string): readonly string[] } | undefined
      let options: readonly string[] = []
      try { options = drone?.complete?.(name, '') ?? [] } catch { /* no completions */ }
      if (!description && options.length === 0) return null
      return { name, kind: 'behaviour', description, icon: 'bolt', options }
    }

    // Other modes carry no extra info yet — keep the dropdown single-column.
    return null
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
  /** Reactive master tag-name list. Bridged so tag intellisense re-reads the
   *  list the moment the (async) registry load finishes — not only after the
   *  first tag mutation. Loaded on boot in ngAfterViewInit. */
  private readonly tagNames$ = fromRuntime(
    get('@hypercomb.social/TagRegistry') as EventTarget,
    () => (get('@hypercomb.social/TagRegistry') as { names?: string[] } | undefined)?.names ?? [],
  )

  // pluggable behaviors — validated at construction, no overlapping operations.
  //
  // Order matters: the first behavior whose `match()` returns true claims
  // the input. PasteUrlNavigateBehavior MUST come before BracketBehavior
  // because both can match bracket-bearing input — URL-shaped pastes
  // (`/dolphin?[model]`, `http://host/dolphin?[model]`) go through the
  // URL behavior; bare typed brackets go through BracketBehavior, which
  // internally dispatches between select (items exist) and create /
  // delete / tag based on the parse.
  #behaviors: CommandLineBehavior[] = this.#validateBehaviors([
    new GoParentBehavior(),
    new SlashBehaviourBehavior(),
    new RemoveCellBehavior(),
    new CutPasteBehavior(),
    new HashMarkerBehavior(),
    new PasteUrlNavigateBehavior(),
    new BracketBehavior(),
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
    const capture = this.#captureMode()
    if (capture) {
      const tile = capture.target?.trim()
      if (tile) {
        return t?.t(`${capture.placeholderKey}.targeted`, { tile }) ?? `add a note for "${tile}"...`
      }
      return t?.t(capture.placeholderKey) ?? 'type a note...'
    }
    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') return t?.t('command-line.placeholder.filter') ?? 'filter tiles...'
    if (ctx.active && ctx.mode === 'slash') return t?.t('command-line.placeholder.slash') ?? 'type a command...'
    return t?.t('command-line.placeholder.default') ?? 'share intent...'
  })

  // ── hover echo ────────────────────────────────────────
  //
  // The tile under the pointer, reported live in the line. Sourced from the
  // overlay's `tile:hover` — the same broadcast the reveal-on-hover label and
  // the pheromone card ride, including its `{label:null}` "pointer left the
  // grid" clear, so the echo can never stick to a tile you already left.
  readonly #hoverEcho = signal('')
  readonly hoverEcho = this.#hoverEcho.asReadonly()

  // ── status indicators ─────────────────────────────────

  readonly #indicators = signal<Map<string, {
    key: string
    icon: string
    label: string
    dismissable?: boolean
    actionable?: boolean
  }>>(new Map())
  readonly activeIndicators = computed(() => [...this.#indicators().values()])

  #indicatorUnsubs: (() => void)[] = []

  // ── view-behavior toggles (right side) ────────────────
  //
  // Stateful on/off icons for the views available at the current node
  // (e.g. website). Sourced from the essentials ViewBee over EffectBus
  // (`view-toggles:changed`); a click routes back as `view:toggle`. The
  // shell renders them next to the open-for-subscribers antenna.
  readonly #viewToggles = signal<readonly { view: string; icon: string; label: string; active: boolean }[]>([])
  readonly viewToggles = this.#viewToggles.asReadonly()

  // NOTE: there is deliberately no `activeViewToggle` exit chip here any
  // more. Website mode's exit belongs to the website surface itself (the
  // site-view drone's `#hc-site-exit`), so exactly ONE control sits in the
  // corner instead of two stacked ones fighting the document actions.

  // Arcade games (Solomon's Key, Bubble Bobble, Arkanoid, Roper, …) are no
  // longer per-game header icons here — they aggregate under the "games"
  // launch group, reached at /games or from the `/sets` landing, the same way
  // websites do. See hypercomb-shared/core/games-group.ts.

  // ── open-for-subscribers toggle ───────────────────────
  //
  // Floating icon inside the command-line that flips
  // swarm.setOpenForSubscribers.
  //
  // Registration is NOT the gate. The SwarmDrone loads with the rest of
  // the module set, so keying visibility off IoC alone parked a swarm
  // antenna in the private/solo view, where there are no subscribers to
  // be open to and the control answers a question nobody asked. It shows
  // only while the hive is actually public ('mesh:public-changed', last-
  // value replayed so a late mount is correct).

  readonly #swarmAvailable = signal(false)
  readonly #meshPublic = signal(false)
  readonly #openForSubscribers = signal(true)  // matches swarm default
  readonly openForSubscribers = this.#openForSubscribers.asReadonly()
  readonly showOpenForSubscribersToggle = computed(() =>
    this.#swarmAvailable() && this.#meshPublic())

  // ── notes toggle ──────────────────────────────────────
  //
  // Mirrors the notes strip's open state (`notes:panel-state`, last-value
  // replayed) and routes clicks to the same `notes:panel` command channel
  // the controls-bar Notes button uses — a second, always-visible switch
  // in the top chrome since notes ride along with every page.
  readonly #notesPanelOpen = signal(false)
  readonly notesPanelOpen = this.#notesPanelOpen.asReadonly()

  readonly #viewsPanelOpen = signal(false)
  readonly viewsPanelOpen = this.#viewsPanelOpen.asReadonly()

  // Beehaviors window open/closed — lights the toggle right of views.
  // Mirrors `features:viewer-state`, which the panel announces on open,
  // close and park (last-value replayed, so a late header mount is correct).
  readonly #featuresPanelOpen = signal(false)
  readonly featuresPanelOpen = this.#featuresPanelOpen.asReadonly()

  // Chat window open/closed — lights the rail's leading chat toggle. Mirrors
  // `chat:window-state` (announced on boot-open, open() and close(); last-value
  // replayed, so a late header mount reads the boot-open correctly).
  readonly #chatPanelOpen = signal(false)
  readonly chatPanelOpen = this.#chatPanelOpen.asReadonly()

  // (The feedback toggle moved to the bottom-right document cluster —
  //  edit-actions.component — taking the forum glyph and the
  //  `feedback:toggle` / `feedback:panel-state` wiring with it.)

  // ── pheromones button ─────────────────────────────────
  //
  // Mirrors the pheromone reach carried on the sticky `tags:filter`
  // broadcast so the top-chrome glyph reads out the current scope
  // (page → children → global), exactly like the controls-bar tag-scope
  // button at the bottom. Clicks TOGGLE the pheromone panel, and the
  // panel's open-state (mirrored below) lights the button.
  readonly #tagScope = signal<'local' | 'children' | 'global'>('local')
  readonly pheromoneScopeIcon = computed(() => {
    switch (this.#tagScope()) {
      case 'children': return 'account_tree'
      case 'global': return 'public'
      default: return 'blur_on'
    }
  })
  // Whether the pheromone panel is open — mirrored from the panel's own
  // `tags:view-state` broadcast (like notes / feedback) so the header toggle
  // lights and the click flips the right way regardless of how the panel was
  // opened (bottom strip, `/tags`, or this button).
  readonly #pheromonePanelOpen = signal(false)
  readonly pheromonePanelOpen = this.#pheromonePanelOpen.asReadonly()

  // ── locked-attempt flash ──────────────────────────────
  //
  // A brief lock icon that flashes to the left of the right-side icons
  // when the user tries to pan or zoom while input is locked (the editor
  // overlay is open). Driven by EffectBus `input:locked-attempt`, which
  // the InputGate emits (throttled) from its claim() lock-rejection path
  // and the wheel-zoom handler. Purely informational — auto-clears.
  readonly #lockedFlash = signal(false)
  readonly lockedFlash = this.#lockedFlash.asReadonly()
  #lockedFlashTimer: ReturnType<typeof setTimeout> | null = null

  #flashLocked(): void {
    this.#lockedFlash.set(true)
    if (this.#lockedFlashTimer) clearTimeout(this.#lockedFlashTimer)
    this.#lockedFlashTimer = setTimeout(() => {
      this.#lockedFlash.set(false)
      this.#lockedFlashTimer = null
    }, LOCKED_FLASH_MS)
  }

  public constructor() {
    console.log('[command-line] initialized with url segments:', this.navigation.segments())

    // Listen for indicator registration/removal
    this.#indicatorUnsubs.push(
      EffectBus.on<{
        key: string
        icon: string
        label: string
        dismissable?: boolean
        actionable?: boolean
      }>('indicator:set', (p) => {
        if (!p?.key) return
        this.#indicators.update(m => { const n = new Map(m); n.set(p.key, p); return n })
        this.#persistIndicators()
      }),
      EffectBus.on<{ key: string }>('indicator:clear', (p) => {
        if (!p?.key) return
        this.#indicators.update(m => { const n = new Map(m); n.delete(p.key); return n })
        this.#persistIndicators()
      }),
      // View-behavior toggles, recomputed by ViewBee on every navigation.
      // Late-subscriber replay means we get the current set immediately.
      EffectBus.on<{ toggles?: { view: string; icon: string; label: string; active: boolean }[] }>(
        'view-toggles:changed',
        (p) => this.#viewToggles.set(Array.isArray(p?.toggles) ? p!.toggles : []),
      ),
      // Hovered tile — echoed in the line as the pointer moves.
      EffectBus.on<{ label?: string | null }>('tile:hover', (p) => {
        this.#hoverEcho.set(p?.label ?? '')
      }),
      // Pan/zoom attempted while input is locked — flash the lock icon.
      // Transient (no replay), so a fresh mount never flashes spuriously.
      EffectBus.on('input:locked-attempt', () => this.#flashLocked()),
      // Notes strip open/closed — lights the notes toggle. These three used to
      // fold each other away by NAME; the dock LANE governs what fits now, so
      // the header only reports state (see dock-lanes.ts).
      EffectBus.on<{ open?: boolean }>('notes:panel-state', ({ open }) => {
        this.#notesPanelOpen.set(!!open)
      }),
      EffectBus.on<{ open?: boolean }>('views:state', ({ open }) => {
        this.#viewsPanelOpen.set(!!open)
      }),
      EffectBus.on<{ open?: boolean }>('features:viewer-state', ({ open }) => {
        this.#featuresPanelOpen.set(!!open)
      }),
      EffectBus.on<{ open?: boolean }>('chat:window-state', ({ open }) => {
        this.#chatPanelOpen.set(!!open)
      }),
      // Pheromone panel open/closed — lights the pheromones toggle.
      EffectBus.on<{ open?: boolean }>('tags:view-state', ({ open }) => {
        this.#pheromonePanelOpen.set(!!open)
      }),
      // Pheromone reach — sticky broadcast, so the glyph hydrates on mount
      // and follows changes made from the panel or the bottom strip.
      EffectBus.on<{ scope?: 'local' | 'children' | 'global' }>('tags:filter', (p) => {
        if (p?.scope) this.#tagScope.set(p.scope)
      }),
    )

    // Restore sticky indicators from localStorage. Producer-owned pills
    // (dismissable === false) are deliberately NOT
    // restored: the drone that owns them re-emits the live, current pill on
    // boot via indicator:set. Rehydrating a persisted copy only risks
    // resurrecting an orphan whose key/label scheme has since changed —
    // that was the stale-pill pile-up. Only genuinely sticky,
    // user-dismissable pills survive a reload. We immediately rewrite storage
    // with the cleaned set so any pre-existing orphans are evicted on first load.
    const saved = localStorage.getItem('hc:indicators')
    if (saved) {
      try {
        const list = JSON.parse(saved) as {
          key: string
          icon: string
          label: string
          dismissable?: boolean
          actionable?: boolean
        }[]
        const m = new Map<string, {
          key: string
          icon: string
          label: string
          dismissable?: boolean
          actionable?: boolean
        }>()
        for (const ind of list) {
          if (!ind?.key || ind.dismissable === false) continue
          m.set(ind.key, ind)
        }
        this.#indicators.set(m)
        this.#persistIndicators()
      } catch { /* ignore corrupt data */ }
    }

    // Bind the open-for-subscribers toggle to the SwarmDrone via
    // whenReady so the icon appears the moment the swarm registers
    // in IoC (could be after this component constructs in the web
    // shell's runtime-bee loading path). Seed the signal from the
    // drone's persisted state, then mirror future changes via
    // EffectBus 'swarm:open-for-subscribers-changed'.
    interface SwarmOpenApi {
      openForSubscribers: () => boolean
      setOpenForSubscribers: (on: boolean) => void
    }
    const ioc = (window as { ioc?: { whenReady?: (k: string, fn: (v: unknown) => void) => void; get?: (k: string) => unknown } }).ioc
    const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
    const onSwarmReady = (swarm: SwarmOpenApi): void => {
      this.#swarmAvailable.set(true)
      try { this.#openForSubscribers.set(!!swarm.openForSubscribers()) } catch { /* keep default */ }
    }
    if (typeof ioc?.whenReady === 'function') {
      ioc.whenReady(SWARM_KEY, (v) => onSwarmReady(v as SwarmOpenApi))
    } else {
      const existing = ioc?.get?.(SWARM_KEY) as SwarmOpenApi | undefined
      if (existing) onSwarmReady(existing)
    }
    this.#indicatorUnsubs.push(
      EffectBus.on<{ open: boolean }>('swarm:open-for-subscribers-changed', (p) => {
        this.#openForSubscribers.set(!!p?.open)
      }),
      // Private/solo hides the antenna entirely — see the field comment.
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
        this.#meshPublic.set(!!p?.public)
      }),
    )
    // Producer-owned indicators are not persisted. Ask their producers to
    // replay current state now that the command-line listener is live.
    EffectBus.emit('indicator:query', {})
  }

  /** Flip the open-for-subscribers toggle. Called from the shell's
   *  floating icon. Idempotent — re-reads the swarm state in case
   *  another tab changed it (localStorage is the source of truth and
   *  the swarm's setter dispatches the effect; we just route the
   *  click to it). */
  onOpenForSubscribersToggle(): void {
    interface SwarmOpenApi {
      openForSubscribers: () => boolean
      setOpenForSubscribers: (on: boolean) => void
    }
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/SwarmDrone',
    ) as SwarmOpenApi | undefined
    if (!swarm?.setOpenForSubscribers) return
    const current = !!swarm.openForSubscribers()
    swarm.setOpenForSubscribers(!current)
  }

  // Notes, feedback and pheromones used to be mutually exclusive BY NAME here:
  // opening any one closed the other two, whatever the screen had room for.
  // That was a second rule on top of the dock's own, and between them a
  // gesture that needs two windows at once (drag a pheromone onto a note) could
  // not be performed at all — from the strip OR from a floated strip, since
  // this rule did not care about docking.
  //
  // There is one rule now: the LANE (dock-lanes.ts) decides how many windows an
  // edge holds, and what it pushes out it PARKS. The header just reports which
  // panels are open so its buttons light correctly.

  /** Flip the notes strip open/closed. The strip broadcasts state back via
   *  `notes:panel-state`; this header toggle is the sole on/off control now
   *  that the controls-bar Notes button is gone. */
  onNotesToggle(): void {
    EffectBus.emit('notes:panel', { visible: !this.#notesPanelOpen() })
  }

  onViewsToggle(): void {
    EffectBus.emit(this.#viewsPanelOpen() ? 'views:close' : 'views:open', {})
  }

  /** Flip the Beehaviors window. Opening from the rail carries NO tile, so
   *  the panel opens on the context — the layer that is loaded — and follows
   *  navigation from there. A tile's puzzle-piece is the other door, and it
   *  puts that tile in the subject instead. */
  onFeaturesToggle(): void {
    EffectBus.emit(this.#featuresPanelOpen() ? 'features:viewer-close' : 'features:context-open', {})
  }

  onChatToggle(): void {
    EffectBus.emit('chat:toggle', {})
  }


  /** Toggle the pheromone panel — open it when closed, close it when open.
   *  The panel owns reach selection and filtering, and mirrors its open-state
   *  back on `tags:view-state` so this button lights and flips in step. */
  onPheromonesToggle(): void {
    EffectBus.emit(this.#pheromonePanelOpen() ? 'tags:view-close' : 'tags:view-open', undefined)
  }

  /** Forward a view-toggle click to ViewBee, which flips the single GLOBAL
   *  render surface. A plain click toggles the view on/off; `disable`
   *  (cmd/long-press) forces it off ("back to tiles"). */
  onViewToggle(e: { view: string; disable: boolean }): void {
    if (!e?.view) return
    EffectBus.emit('view:toggle', { view: e.view, disable: e.disable })
  }

  onIndicatorDismiss(key: string): void {
    EffectBus.emit('indicator:dismiss', { key })
    this.#indicators.update(m => { const n = new Map(m); n.delete(key); return n })
    this.#persistIndicators()
  }

  onIndicatorActivate(key: string): void {
    EffectBus.emit('indicator:activate', { key })
  }

  #persistIndicators(): void {
    // Only user-dismissable pills are persisted. Producer-owned pills
    // (dismissable === false) are re-emitted live by their drone on every
    // boot, so keeping them out of storage is the structural guard against
    // a stale key/label outliving the producer that created it.
    const list = [...this.#indicators().values()]
      .filter(ind => ind.dismissable !== false && ind.actionable !== true)
    if (list.length > 0) {
      localStorage.setItem('hc:indicators', JSON.stringify(list))
    } else {
      localStorage.removeItem('hc:indicators')
    }
  }

  // -------------------------------------------------
  // completion context
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    // Capture mode suspends all normal parsing — treat as inactive so slash,
    // filter, tag, bracket, and action completions are all disabled. Enter
    // and Escape are handled directly by the shell hooks.
    if (this.#captureMode()) return { active: false }

    const v = this.value()

    // `?` enters filter mode — bare `?keyword` is the form people actually
    // type (and the one the tutorial is read as teaching); `>?keyword` is
    // kept because it is what the lesson text spells and what muscle memory
    // holds. Nothing is lost by claiming a leading `?`: normalizeCell strips
    // `?` entirely, so it can never begin a real cell name.
    const filterHead = v.startsWith('>?') ? '>?' : v.startsWith('?') ? '?' : ''
    if (filterHead) {
      const raw = v.slice(filterHead.length)
      const keyword = this.completions.normalize(raw)
      return {
        active: true,
        mode: 'filter',
        head: filterHead,
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

    // '@' feature mode — `abc@frag` (add) or `~abc@frag` (remove). The fragment
    // after the last `@` is matched against the VisualBeeRegistry, so the
    // dropdown lists registered behaviors with their descriptions. Checked
    // before the `~` remove branch because `~abc@x` would otherwise be read as
    // a cell removal.
    const featRemoveCtx = v.match(FEATURE_REMOVE_RE)
    const featAddCtx = featRemoveCtx ? null : v.match(FEATURE_RE)
    const featCtx = featRemoveCtx ?? featAddCtx
    if (featCtx) {
      const frag = featCtx[2]
      return {
        active: true,
        mode: 'feature',
        head: v.slice(0, v.length - frag.length),
        raw: frag,
        normalized: frag.toLowerCase().trim(),
        style: 'space',
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
        // OBJECT FIRST. A behaviour that registered a command root describes its
        // shape instead of parsing strings, and the walk happens here rather
        // than thirty-three times over. Everything else falls through to the
        // behaviour's own completer, so no un-migrated behaviour can regress.
        const root = commandRoot(cmdName)
        if (root) return completeCommandPath(root, this.#slashArgsOf(ctx, cmdArgMatch[0]))
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

    // '@' feature mode: list registered behaviors (filtered by fragment).
    if (ctx.mode === 'feature') {
      return this.#featureMatches().map(m => m.view)
    }

    // plain colon tag mode: the `tags` object's members — the tag pool's own
    // contents, ranked by how many tiles carry each. Reading the tag list
    // through the SAME protocol the slash args use is the point: one walk, and
    // the vocabulary comes from the pool rather than from a list in here. The
    // old inline read stays as the fallback for a shell with no root yet.
    if (ctx.mode === 'tag') {
      // Depend on the registry signal so the dropdown still refreshes when the
      // pool loads — the object itself reads through IoC and has no signal.
      const known = this.tagNames$()
      const root = commandRoot('tags')
      if (root) return completeCommandPath(root, ctx.normalized)
      const metrics = get('@diamondcoreprocessor.com/OverlapMetrics') as { tagCount(name: string): number } | undefined
      let allTags = [...known]
      if (ctx.normalized) allTags = allTags.filter(n => n.toLowerCase().startsWith(ctx.normalized))
      // Overlap count = how many tiles carry the tag (popularity); alpha ties.
      return allTags.sort((a, b) => (metrics?.tagCount(b) ?? 0) - (metrics?.tagCount(a) ?? 0) || a.localeCompare(b))
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

      // tag phase (`[a,b]:tag`): suggest tag names, most-used first — same source
      // and ranking as the plain `label:tag` mode.
      if (phase === 'tag') {
        const metrics = get('@diamondcoreprocessor.com/OverlapMetrics') as { tagCount(name: string): number } | undefined
        let allTags = [...this.tagNames$()]
        if (ctx.normalized) allTags = allTags.filter(n => n.toLowerCase().startsWith(ctx.normalized))
        return allTags.sort((a, b) => (metrics?.tagCount(b) ?? 0) - (metrics?.tagCount(a) ?? 0) || a.localeCompare(b))
      }

      // operation phase: suggest operation keywords with / prefix.
      // The slash intellisense stays closed until the `/` is actually typed —
      // a freshly closed bracket (`[a,b]`) is not yet a command, so dumping the
      // whole operation list there reads as the dropdown opening on its own.
      // `head` ends with `/` while an op fragment is being typed; a fully typed
      // op lands in `normalized` with the slash already in `head`/value.
      if (phase === 'operation') {
        if (!ctx.head.endsWith('/') && !ctx.normalized) return []
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
        const allTags = this.tagNames$()
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

  /**
   * The command object being walked right now, if any — the seam that lets one
   * protocol serve every mode. Slash arguments resolve by command name; the tag
   * modes resolve to the `tags` root. Anything with no root registered returns
   * undefined and the caller keeps its existing behaviour.
   */
  #activeRoot(): { root: CommandObject; args: string } | undefined {
    const ctx = this.context()
    if (!ctx.active) return undefined
    if (ctx.mode === 'slash') {
      const match = ctx.head.match(/^\/(\S+?)[\s\[]/i)
      if (!match) return undefined
      const root = commandRoot(match[1].toLowerCase())
      return root ? { root, args: this.#slashArgsOf(ctx, match[0]) } : undefined
    }
    if (ctx.mode === 'tag' || (ctx.mode === 'select' && this.#selectPhase() === 'tag')) {
      const root = commandRoot('tags')
      return root ? { root, args: ctx.normalized } : undefined
    }
    return undefined
  }

  /** Rebuild the full argument string from the head and the fragment. */
  #slashArgsOf(ctx: { head: string; raw: string }, cmdPrefix: string): string {
    const headArgs = ctx.head.slice(cmdPrefix.length)
    return ctx.head[cmdPrefix.length - 1] === '['
      ? '[' + headArgs + ctx.raw
      : headArgs + ctx.raw
  }

  /** Whether the swatches on offer are whole pictures rather than colour dots.
   *  Asked of the members themselves — a gradient or an image needs a wide
   *  chip, a flat colour does not — so no mode or command is named here. */
  public readonly wideSwatches = computed<boolean>(() => {
    const active = this.#activeRoot()
    if (!active) return false
    for (const member of commandMembersFor(active.root, active.args).values()) {
      if (member.swatch && /gradient|url\(/i.test(member.swatch)) return true
    }
    return false
  })

  /** Colour swatches for the dropdown: accent presets in `/accent`, each tag's
   *  own colour in the tag modes (`label:tag` and `[a,b]:tag`), and — for
   *  `/background` — a miniature of the look each theme would give, so the
   *  choice is made by eye instead of by name. */
  public readonly dropdownColorMap = computed<ReadonlyMap<string, string>>(() => {
    const accent = this.accentColorMap()
    if (accent.size) return accent
    // Members carry their own swatch — a whole backdrop, a tag's colour, an
    // image — and the dropdown neither knows nor cares which it is drawing.
    const active = this.#activeRoot()
    if (active) {
      const map = new Map<string, string>()
      for (const [key, member] of commandMembersFor(active.root, active.args)) {
        if (member.swatch) map.set(key, member.swatch)
      }
      if (map.size) return map
    }
    const ctx = this.context()
    const inTagMode = ctx.active && (ctx.mode === 'tag' || (ctx.mode === 'select' && this.#selectPhase() === 'tag'))
    if (!inTagMode) return new Map()
    const registry = get('@hypercomb.social/TagRegistry') as { color(name: string): string } | undefined
    if (!registry) return new Map()
    const map = new Map<string, string>()
    for (const n of this.tagNames$()) {
      const c = registry.color(n)
      if (c) map.set(n, c)
    }
    return map
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

    // Warm the master tag list so `:` shows every tag immediately — even on a
    // tile that has none (the registry is otherwise loaded lazily, only on the
    // first tag mutation). The reactive tagNames$ bridge picks up the load.
    void (get('@hypercomb.social/TagRegistry') as { ensureLoaded?: () => Promise<void> } | undefined)?.ensureLoaded?.()

    window.ioc.register('@hypercomb.social/CommandLineBehaviors', this.behaviorReference)

    window.addEventListener('navigate', this.#onNavigate)
    window.addEventListener('popstate', this.#onNavigate)

    this.#mobileQuery = window.matchMedia('(max-width: 599px), (max-height: 449px)')
    this.isMobile.set(this.#mobileQuery.matches)
    this.#mobileQuery.addEventListener('change', this.#mobileQueryHandler)
    this.#commandLineToggleUnsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd !== 'ui.commandLineToggle') return
      this.shell?.focus()
    })

    // Prefill. `focus`, `select` and `subject` are optional and additive: a
    // gesture elsewhere can COMPOSE a command and hand the participant the one
    // word it could not know — dragging a portal onto the hive fills in
    // `/reference <name> = <path>`, selects the name so Enter accepts it and
    // typing renames it, and puts the dragged thing's picture in the glyph slot
    // so the line says WHAT it is about while you decide what to call it.
    // Without them this behaves exactly as before.
    this.#prefillUnsub = EffectBus.on<{
      value: string
      focus?: boolean
      select?: [number, number]
      subject?: { previewUrl?: string; label: string; icon?: string } | null
    }>('search:prefill', ({ value, focus, select, subject }) => {
      this.#setShellValue(value, false)
      // A prefill with no subject CLEARS the chip rather than leaving the
      // previous gesture's face over an unrelated command.
      this.commandSubject.set(subject ?? null)
      if (!focus) return
      // A collapsed mobile bar has to open first — focusing an input inside a
      // display:none header is the known dead end (see `command:focus`).
      if (this.mobileHidden()) EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
      this.#focusShellSoon(select)
    })

    this.#commandFocusUnsub = EffectBus.on<{ cell: string }>('command:focus', ({ cell }) => {
      // Prefill the cell name (the grammar) followed by a trailing `/` so the
      // caret lands ready to continue the path/command. `#setShellValue` calls
      // placeCaretAtEnd(), so the cursor sits right after the slash.
      // A collapsed mobile bar (landscape) must open first — focusing an
      // input inside a display:none header was the quick-menu centre-slot
      // dead end on phones.
      if (this.mobileHidden()) {
        EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
      }
      this.#setShellValue(cell ? `${cell}/` : cell, false)
      this.#focusShellSoon()
    })

    // Enter a text-capture mode (e.g. notes). Suspends normal parsing and
    // routes Enter to the configured commit effect with the target label.
    // Explicit cancel from the notes strip close button — clears capture
    // mode without committing. Idempotent when not capturing.
    this.#notesCancelUnsub = EffectBus.on('notes:cancel', () => {
      if (this.#captureMode()) this.clear()
    })

    type EnterModePayload = {
      mode: string
      target: string
      prefill?: string
      editId?: string
    }
    this.#enterModeUnsub = EffectBus.on<EnterModePayload>('command:enter-mode', (payload: EnterModePayload) => {
      if (!payload?.mode || !payload?.target) return
      if (payload.mode === 'note-capture') {
        const extra: Record<string, unknown> = {}
        if (payload.editId) extra['editId'] = payload.editId
        this.#captureMode.set({
          commitEffect: 'note:commit',
          target: payload.target,
          placeholderKey: 'notes.capturePlaceholder',
          extra,
        })
        const prefill = payload.prefill ?? ''
        this.#setShellValue(prefill, false)
        this.shell?.focus()
        if (prefill) this.shell?.selectAll()
      }
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

    // Mobile input visibility — on desktop and PORTRAIT phones the command
    // line is always visible (portrait pins it as the top prompt surface);
    // only LANDSCAPE phones collapse it, revealed by the sidebar keyboard
    // toggle / mic / long-press. `focus: false` marks sync-driven
    // emissions (media-query changes, boot) that must not steal focus or
    // pop the soft keyboard; user-gesture emitters omit it and get focus.
    this.#mobileVisibilityUnsub = EffectBus.on<{ visible: boolean; mobile: boolean; focus?: boolean }>(
      'mobile:input-visible',
      ({ visible, mobile, focus }) => {
        this.mobileHidden.set(mobile && !visible)
        if (mobile && visible && focus !== false) {
          // give focus to the shell so the keyboard pops up immediately
          this.#focusShellSoon()
        }
      },
    )

    // Ask lifecycle feedback — the visible answer to "did anything happen?".
    // ask:queued (llm.queen) raises a non-dismissable pending pill on the
    // command line; ask:answered (bridge worker, emitted when the responder
    // retires the ask AFTER writing its note) drops the pill once no asks
    // remain and toasts where the answer landed. Count-based: several asks
    // in flight share one pill, and it only clears when the last resolves.
    this.#askQueuedUnsub = EffectBus.on<{ sig: string }>('ask:queued', () => {
      this.#pendingAsks++
      this.#indicators.update(m => {
        const n = new Map(m)
        n.set('ask-pending', { key: 'ask-pending', icon: 'psychology', label: 'Waiting for an answer — it will arrive as a note', dismissable: false })
        return n
      })
    })
    this.#askAnsweredUnsub = EffectBus.on<{ sig: string; appliesTo?: unknown }>('ask:answered', ({ appliesTo }) => {
      this.#pendingAsks = Math.max(0, this.#pendingAsks - 1)
      if (this.#pendingAsks === 0) {
        this.#indicators.update(m => { const n = new Map(m); n.delete('ask-pending'); return n })
      }
      const list = Array.isArray(appliesTo) ? appliesTo.map(x => String(x ?? '')).filter(Boolean) : []
      const where = list.length ? list.join(', ') : 'the page'
      EffectBus.emit('toast:show', { type: 'success', title: 'Answered', message: `Note added to ${where} — open its notes to read it.` })
    })

    // Bi-directional sync: external selection changes → update command line
    this.#selectionSyncUnsub = EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', (payload) => {
      if (this.#syncDirection === 'command') return // prevent feedback loop
      if (this.#captureMode()) return // never clobber a note capture with /select[...]
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
        n.set('move-hint', { key: 'move-hint', icon: 'open_with', label: 'Move mode', dismissable: false })
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

    // remote bridge submit (Claude CLI, future /transcript) — same path as a
    // human keystroke or a voice release. Single state machine, three input
    // sources. See claude-bridge.worker.ts.
    this.#remoteSubmitUnsub = EffectBus.on<{ text: string }>('command-line:remote-submit', ({ text }) => {
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
      attachment?: { name: string; mime: string; size: number; sig: string } | null
      name?: string | null
      armId?: string | null
      atTop?: boolean
    }>('command:arm-resource', (payload) => {
      if (!payload || (!payload.largeSig && !payload.url)) return
      // A link arms on release and is filled in when its card arrives. Once the
      // participant has committed or dismissed that slot it is RETIRED, and the
      // late fill-in must not raise a chevron over a gesture they finished.
      if (payload.armId && this.#retiredArms.has(payload.armId)) return
      const prev = this.armedResource()
      if (prev?.previewUrl && prev.previewUrl !== payload.previewUrl) {
        try { URL.revokeObjectURL(prev.previewUrl) } catch { /* ignore */ }
      }
      this.armedResource.set(payload)
      // Seed the tile name with the link's default title. A link arms with a
      // name derived from its URL and is upgraded to the open-graph title a
      // beat later, so the seed is replaced while it is still OURS: an empty
      // field, or a field still holding exactly what we last put there. Once
      // the participant has typed, the line is theirs and nothing overwrites
      // it. Selected, so an immediate keystroke replaces it and Enter takes it.
      if (payload.name) {
        const seed = this.#sanitizeArmName(payload.name)
        const current = this.value().trim()
        if (seed && seed !== current && (current === '' || current === this.#seededArmName)) {
          this.shell?.setValue(seed)
          this.value.set(this.shell?.value() ?? seed)
          this.shell?.selectAll()
          this.#seededArmName = seed
        }
      }
      this.shell?.focus()
    })

    // Dropping a link on empty space IS the creation — the drop commits itself
    // rather than waiting for an Enter the participant never asked to press.
    // The title stays in the line afterwards, naming what just landed; a name
    // IS an address here, so a stray Enter re-commits that same tile rather
    // than making a second one.
    this.#commitArmedUnsub = EffectBus.on<{ armId?: string | null }>(
      'command:commit-armed',
      (payload) => {
        const armed = this.armedResource()
        if (!armed) return
        if (payload?.armId && armed.armId !== payload.armId) return
        const named = this.value()
        void this.commitCreateCellInPlace().then(() => {
          const seed = named.trim()
          if (!seed) return
          this.shell?.setValue(seed)
          this.value.set(this.shell?.value() ?? seed)
          this.#seededArmName = seed
        })
      },
    )

    // A slot armed on release can be retracted — the safety check runs after
    // the arm now, so a denied link has to take its chevron back down.
    this.#disarmResourceUnsub = EffectBus.on<{ armId?: string | null }>(
      'command:disarm-resource',
      (payload) => {
        const armed = this.armedResource()
        if (!armed) return
        if (payload?.armId && armed.armId !== payload.armId) return
        this.onArmedResourceDismiss()
      },
    )
  }

  /**
   * WHAT THE LINE IS ABOUT — set by a gesture that composed the command (see
   * the `search:prefill` handler). Purely a label: it commits nothing and is
   * never read by any Enter path, which is exactly what keeps it out of
   * `armedResource`'s way (that one suppresses completion-on-Enter, and a
   * composed `/reference` line very much wants its completions).
   */
  readonly commandSubject = signal<{ previewUrl?: string; label: string; icon?: string } | null>(null)

  /** Put the subject chip away. The composed text stays — dismissing a label
   *  is not deleting what someone is midway through typing. */
  public onSubjectDismiss = (): void => {
    this.commandSubject.set(null)
  }

  /** Clear the armed resource (thumbnail click, Escape, or after successful commit). */
  public onArmedResourceDismiss = (): void => {
    const prev = this.armedResource()
    if (prev?.previewUrl) {
      try { URL.revokeObjectURL(prev.previewUrl) } catch { /* ignore */ }
    }
    this.#seededArmName = ''
    if (prev?.armId) {
      this.#retiredArms.add(prev.armId)
      // One drop is in flight at a time, so this only ever guards against the
      // fill-in of a slot just closed; a handful of ids is the whole horizon.
      if (this.#retiredArms.size > 8) {
        this.#retiredArms.delete(this.#retiredArms.values().next().value as string)
      }
    }
    this.armedResource.set(null)
  }

  /** Armed slots already committed or dismissed — their fill-ins are ignored. */
  readonly #retiredArms = new Set<string>()

  /** The last name this component seeded into the line — replaceable while the
   *  participant has not typed over it. Empty once the line is theirs. */
  #seededArmName = ''

  /** Strip command-line grammar chars ([ ] , : / @) so a dropped link's title
   *  can seed the tile name without tripping select/tag/slash/feature parsing. */
  #sanitizeArmName(raw: string): string {
    return raw.replace(/[[\],:\/@]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim()
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
    /** A document to attach to the cell on Enter (file-drop dropbox flow). */
    attachment?: { name: string; mime: string; size: number; sig: string } | null
    /** Default tile name suggested by the dropped resource (link title). */
    name?: string | null
    /** Identity of this armed slot, so a late card fill-in can find it. */
    armId?: string | null
    /** Pin the created tile to the first slot — a dropped link lands on top. */
    atTop?: boolean
  } | null>(null)
  #armResourceUnsub?: () => void
  #disarmResourceUnsub?: () => void
  #commitArmedUnsub?: () => void
  /** True when the command-line should be collapsed on mobile (toggle off). */
  readonly mobileHidden = signal(false)
  #mobileVisibilityUnsub?: () => void
  #askQueuedUnsub?: () => void
  #askAnsweredUnsub?: () => void
  /** Asks currently in flight — the pending pill shows while > 0. */
  #pendingAsks = 0
  readonly voiceSupported = VoiceInputService.supported()
  readonly pushToTalkEnabled = signal(localStorage.getItem('hc:push-to-talk') === 'true')

  /** Phone-shaped viewport (narrow OR short — a phone on its side is wide and
   *  short). Same query as controls-bar's `isMobile`; the two must agree, or
   *  the mic shows on one surface and not the other. Drives ONE thing here:
   *  the mic lives on the shell's icon rail on mobile, where the control bar
   *  used to carry it. */
  readonly isMobile = signal(
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 599px), (max-height: 449px)').matches
      : false,
  )
  #mobileQuery: MediaQueryList | null = null
  #mobileQueryHandler = (e: MediaQueryListEvent): void => { this.isMobile.set(e.matches) }

  /** Mic pressed on the shell's rail. Same state machine the control bar's
   *  mic drove before it moved here — tap toggles listening, hold is
   *  push-to-talk — reached through the same effects so nothing else has to
   *  know where the button lives. */
  public onRailMicPress = (): void => { this.#onMobileMicPress() }
  public onRailMicRelease = (): void => { this.#onMobileMicRelease() }
  #voiceActiveUnsub?: () => void
  #pushToTalkUnsub?: () => void
  #prefillUnsub?: () => void
  #commandFocusUnsub?: () => void
  #enterModeUnsub?: () => void
  #notesCancelUnsub?: () => void
  #commandLineToggleUnsub?: () => void
  #touchDraggingUnsub?: () => void
  #viewActiveUnsub?: () => void
  #selectionSyncUnsub?: () => void
  #voiceInterimUnsub?: () => void
  #voiceSubmitUnsub?: () => void
  #remoteSubmitUnsub?: () => void
  // Location segments (bracket stripped) at the last navigate event.
  #lastNavKey = ''
  readonly #onNavigate = (): void => {
    // Only a LOCATION change resets the bar. Selection-only URL writes
    // (`/parent/[a,b]` — same segments, new bracket tail) also dispatch
    // 'navigate' so SelectionService can sync from the URL; clearing on
    // those wiped the selection the same action had just made (clear()
    // calls selection.clear() while the bar is in select mode), which
    // broke every keyboard cut/copy after a `[name]` select.
    const key = this.navigation.segments().join('/')
    if (key === this.#lastNavKey) return
    this.#lastNavKey = key
    this.clear()
  }

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

  /** Mobile "GO" button: submit the text. Portrait pins the command line
   * so GO never collapses it there (the bar stays ready for the next
   * command); landscape collapses back to the sidebar's keyboard toggle. */
  readonly closeMobileInput = (): void => {
    const v = this.value().trim()
    if (v) {
      void this.#preprocessTagsThenExecute(this.value())
    }
    // Landscape phones are WIDE but SHORT. Width-based detection on
    // purpose: the soft keyboard shrinks only the HEIGHT, so a portrait
    // phone mid-typing can pseudo-flip orientation queries but never
    // exceeds 599px width — this predicate cannot misread it.
    const landscapePhone = window.innerWidth > 599 && window.innerHeight <= 449
    if (landscapePhone) {
      EffectBus.emit('mobile:input-visible', { visible: false, mobile: true })
    }
  }

  // ── mobile mic state machine ──────────────────────────────
  // The mic is a VOICE control only — it NEVER hides the command line.
  // (Hiding on release was the "tap the mic and the command line flashes
  // away" bug: a relaxed tap crossed the hold threshold and the release
  // handler collapsed the bar it had just opened. Portrait now pins the
  // bar permanently; landscape collapses only via GO / the keyboard
  // toggle.)
  //   Tap while idle:      start listening (toggle on).
  //   Tap while listening: stop — VoiceInputService emits voice:submit,
  //                        which executes the dictated text.
  //   Hold:                push-to-talk — listen while held, submit on
  //                        release.
  // If the bar is collapsed (landscape), the first press reveals it.
  #micHoldTimer: ReturnType<typeof setTimeout> | null = null
  #micLongPressFired = false
  #micWasListening = false
  #micPressUnsub?: () => void
  #micReleaseUnsub?: () => void

  #onMobileMicPress = (): void => {
    this.#micLongPressFired = false
    this.#micWasListening = this.voiceActive()

    if (this.mobileHidden()) {
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
      queueMicrotask(() => this.shell?.focus())
    }
    if (!this.#micWasListening) this.voiceService?.start()

    this.#micHoldTimer = setTimeout(() => {
      this.#micLongPressFired = true
      this.#micHoldTimer = null
    }, MIC_LONG_PRESS_MS)
  }

  #onMobileMicRelease = (): void => {
    if (this.#micHoldTimer) {
      clearTimeout(this.#micHoldTimer)
      this.#micHoldTimer = null
    }
    const wasHold = this.#micLongPressFired
    this.#micLongPressFired = false

    // Hold = push-to-talk: release ends the dictation (voice:submit fires
    // with the text and executes it). Tap = toggle: releasing the press
    // that STARTED the dictation keeps it listening; a tap while it was
    // already listening stops it.
    if (wasHold || this.#micWasListening) {
      this.voiceService?.stop()
    }
  }

  public ngOnDestroy(): void {
    this.#prefillUnsub?.()
    this.#commandFocusUnsub?.()
    this.#enterModeUnsub?.()
    this.#notesCancelUnsub?.()
    this.#commandLineToggleUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#viewActiveUnsub?.()
    this.#mobileVisibilityUnsub?.()
    this.#askQueuedUnsub?.()
    this.#askAnsweredUnsub?.()
    this.#selectionSyncUnsub?.()
    this.#voiceInterimUnsub?.()
    this.#voiceSubmitUnsub?.()
    this.#remoteSubmitUnsub?.()
    this.#voiceActiveUnsub?.()
    this.#pushToTalkUnsub?.()
    this.#micPressUnsub?.()
    this.#micReleaseUnsub?.()
    this.#armResourceUnsub?.()
    this.#disarmResourceUnsub?.()
    this.#commitArmedUnsub?.()
    this.onArmedResourceDismiss()
    if (this.#micHoldTimer) {
      clearTimeout(this.#micHoldTimer)
      this.#micHoldTimer = null
    }
    if (this.#lockedFlashTimer) {
      clearTimeout(this.#lockedFlashTimer)
      this.#lockedFlashTimer = null
    }
    for (const unsub of this.#indicatorUnsubs) unsub()
    window.removeEventListener('navigate', this.#onNavigate)
    window.removeEventListener('popstate', this.#onNavigate)
    this.#mobileQuery?.removeEventListener('change', this.#mobileQueryHandler)
  }

  // template helpers removed — now owned by CommandShellComponent

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  /** Bridge: shell value changed (fires on every keystroke). */
  public onShellValueChange = (v: string): void => {
    this.value.set(v)

    // Typing leaves the recall walk — the line is the user's again.
    this.#historyIndex = -1

    // An emptied line is about nothing. Editing the composed text does NOT
    // clear the chip — renaming the tile is the whole point of handing the line
    // over — but deleting all of it means the gesture was abandoned.
    if (!v.trim()) this.commandSubject.set(null)

    // auto-populate index when typing '(' after /move
    if (this.#autoPopulateMoveIndex(v)) {
      // shell value was mutated — re-sync
    }

    // auto-advance a fully-typed slash command into its parameter list
    this.#autoEnterSlashParams(v)

    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') {
      EffectBus.emit('search:filter', { keyword: ctx.normalized })
      if (!this.#filterModeOpen) EffectBus.emit('swarm:filter-view-open', {})
    } else if (this.lastFilterKeyword) {
      EffectBus.emit('search:filter', { keyword: '' })
      this.lastFilterKeyword = ''
    }
    if (ctx.active && ctx.mode === 'filter') {
      this.lastFilterKeyword = ctx.normalized
    }
    this.#filterModeOpen = ctx.active && ctx.mode === 'filter'

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
    // Sub-path / leaf / bracket phase are derived from `value()` — see
    // #pathContext. Nothing to refresh here.
  }

  private lastFilterKeyword = ''
  #filterModeOpen = false

  /** Bridge: shell forwarded a keydown it didn't consume (not Escape/Up/Down/Tab/Enter). */
  public onShellKeydown = (e: KeyboardEvent): void => {
    const v = this.value()

    // Shift+Enter → run the pluggable behaviors with the REAL event so the
    // Shift-gated ones (ShiftEnterNavigateBehavior — navigate, never create)
    // can match. The shell emits `commit` only for plain Enter, so without
    // this Shift+Enter fell through unhandled and navigate-by-name was dead.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      const raw = v.trim()
      if (!raw) return
      for (const behavior of this.#behaviors) {
        if (behavior.match(e, raw)) {
          void Promise.resolve(behavior.execute(raw)).then(() => this.clear())
          return
        }
      }
      return
    }

    // Escape in capture mode: cancel without committing.
    if (e.key === 'Escape' && this.#captureMode()) {
      e.preventDefault()
      this.#captureMode.set(null)
      this.clear()
      return
    }

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

    // Escape on an empty line → exit command-line mode entirely: blur the
    // input so keystrokes return to the canvas. This is the "type, then get
    // out" gesture — without it a focused-but-empty command line traps every
    // keystroke with no way back to the hex view except the mouse.
    if (e.key === 'Escape') {
      e.preventDefault()
      this.shell?.blur()
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

    // Plain Up/Down with nothing else claiming them → walk the commands you
    // have already run, the way every terminal does. The shell only forwards
    // these when the completion dropdown is closed, so recall never fights
    // suggestion navigation.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown')
      && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      && !this.#captureMode() && this.#selectPhase() === 'none') {
      if (this.#recallHistory(e.key === 'ArrowUp' ? 1 : -1)) e.preventDefault()
      return
    }
  }

  // ── command history (local recall, like a terminal) ──────
  //
  // Not hive state: what you typed at the bar is per-device convenience, the
  // same class as the clipboard. It lives in localStorage, never in a layer.

  #commandHistory: string[] = loadCommandHistory()
  /** -1 = live line; 0 = most recent entry; walks back as it grows. */
  #historyIndex = -1
  /** What was typed before the walk started, restored on Down past the end. */
  #historyDraft = ''

  /** Record an executed line. Newest first; consecutive repeats collapse. */
  #recordHistory(line: string): void {
    const entry = line.trim()
    if (!entry || entry === this.#commandHistory[0]) { this.#historyIndex = -1; return }
    this.#commandHistory = [entry, ...this.#commandHistory].slice(0, COMMAND_HISTORY_MAX)
    this.#historyIndex = -1
    this.#historyDraft = ''
    try {
      localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(this.#commandHistory))
    } catch { /* quota / private mode — recall is best-effort */ }
  }

  /** Step through history. `dir` +1 = older (Up), -1 = newer (Down). */
  #recallHistory(dir: 1 | -1): boolean {
    if (!this.#commandHistory.length) return false
    const next = this.#historyIndex + dir
    if (next < -1 || next >= this.#commandHistory.length) return false
    if (this.#historyIndex === -1 && dir === 1) this.#historyDraft = this.value()
    this.#historyIndex = next
    const line = next === -1 ? this.#historyDraft : this.#commandHistory[next] ?? ''
    this.#setShellValue(line, true)
    return true
  }

  /**
   * Bridge: shell Enter pressed — accept the completion, then tag pre-process
   * then execute.
   *
   * Enter is the ACCEPT-AND-SEND key: what the dropdown is offering (the ghost
   * text you can read, or the row you arrowed onto) is taken first and the
   * COMPLETED line is what runs. Tab stays the pure completion key — it fills
   * the line and never sends.
   */
  public onShellCommit = (v: string): void => {
    const capture = this.#captureMode()
    if (capture) {
      this.#commitCapture(capture, v)
      return
    }
    const completed = this.#completeOnEnter(v)
    if (completed === null) return
    // The line has been spent, so it is no longer about anything. Cleared
    // BEFORE the dispatch: executing may prefill the line again (a command
    // that hands the participant a follow-up), and that prefill owns the chip.
    this.commandSubject.set(null)
    void this.#preprocessTagsThenExecute(completed)
  }

  /**
   * Apply the highlighted completion before Enter executes, and decide whether
   * the completed line is ready to run.
   *
   * Returns the string to execute, or `null` when Enter must NOT execute —
   * either the completion WAS the action (tag mode persists the tag) or the
   * accepted fragment expects more input (a command's arguments, the next item
   * of a bracket list, a deeper path). "Expects more input" is not re-derived
   * here: {@link onShellCompletionAccepted} already encodes it by leaving the
   * dropdown OPEN, so a completion that suppresses the dropdown is terminal and
   * sends. The one override is a slash ARGUMENT, which stays open so Tab can
   * chain but is a finished command far more often than not.
   *
   * Completion only happens when something is visibly on offer: a typed
   * fragment WITH ghost text, or a row the user deliberately arrowed onto.
   * Escape suppresses the dropdown and `suggestions()` then reports empty, so
   * Escape-then-Enter still sends exactly what was typed.
   */
  #completeOnEnter(raw: string): string | null {
    // A dropped resource is a "make THIS" gesture — the seeded name is the
    // name, never a prefix of some other tile the dropdown happens to know.
    if (this.armedResource()) return raw

    const list = this.suggestions()
    if (!list.length) return raw

    const ctx = this.context()
    if (!ctx.active) return raw

    const index = this.shell?.activeIndex() ?? 0
    const best = list[index] ?? list[0]
    if (!best) return raw

    // Ghost text alone is not enough: with an empty fragment (`projects/`, a
    // bare `/`) every suggestion "extends" it, and Enter would silently walk
    // into the first child instead of sending what is already a whole command.
    const moved = index > 0
    const offered = this.completionTypedPrefix().trim().length > 0 && this.ghostValue() !== ''
    if (!moved && !offered) return raw

    // tag mode accepts by PERSISTING the tag — nothing is left to run.
    if (ctx.mode === 'tag') {
      this.onShellCompletionAccepted(best)
      return null
    }

    this.onShellCompletionAccepted(best)
    const completed = this.value()
    if (!completed.trim()) return null

    // A trailing space/comma is the accept handler saying "your argument goes
    // here" — never run a parameterised command with the argument missing.
    if (/[\s,]$/.test(completed)) return null

    if (this.shell?.suppressed()) return completed

    if (ctx.mode === 'slash' && ctx.head !== '/' && !DESTRUCTIVE_SLASH_RE.test(ctx.head)) {
      return completed
    }

    return null
  }

  /**
   * Shared commit path for both direct Enter and the tag-preprocessor route.
   *
   * - Non-empty text → emit the configured commit effect and *stay* in
   *   capture mode so the user can immediately type another note. The
   *   input is cleared and refocused.
   * - Empty text → exit capture mode entirely (natural close gesture).
   * - Edit (has `editId`) → always a one-shot; exit after commit.
   */
  #commitCapture(
    capture: { commitEffect: string; target: string; extra: Record<string, unknown> },
    raw: string,
  ): void {
    const text = raw.trim()

    if (!text) {
      this.#captureMode.set(null)
      this.clear()
      return
    }

    EffectBus.emit(capture.commitEffect, {
      cellLabel: capture.target,
      text,
      ...capture.extra,
    })

    const isEdit = !!capture.extra['editId']
    if (isEdit) {
      this.#captureMode.set(null)
      this.clear()
      return
    }

    // Stay in capture mode — reset the input so the next note is ready.
    this.#setShellValue('', false)
    this.shell?.focus()
  }

  /**
   * Pre-process tags from input, persist them, then dispatch to the appropriate handler
   * with the cleaned input (tag syntax stripped).
   */
  async #preprocessTagsThenExecute(original: string): Promise<void> {
    // In capture mode any incoming submission (voice, mobile "go", etc.) must
    // still route to the configured commit effect rather than the normal parser.
    const capture = this.#captureMode()
    if (capture) {
      this.#commitCapture(capture, original)
      return
    }

    // Remember the line as TYPED (before tag stripping) — recall should give
    // back exactly what the user ran, ready to edit and run again.
    this.#recordHistory(original)

    // A LINE THAT IS A URL IS A LINK, NOT A NAME. This is the phone's drop:
    // on a touch device no drag ever fires, and pasting the address is the
    // one intake gesture the platform offers — so it must reach the same
    // pipeline a desktop drop does (safety check, title unfurl, poster
    // thumbnail, auto-commit) instead of falling through to the cell parser,
    // which splits on the URL's slashes and mints husk cells out of its
    // scheme and host. Checked before tag extraction: a `#fragment` is part
    // of the address, not a tag. Whole-line matches only — a URL mentioned
    // inside a longer line is still just text.
    const line = original.trim()
    if (/^https?:\/\/\S+$/i.test(line) || /^www\.\S+\.\S+$/i.test(line)) {
      // Except our OWN address: a pasted share/selection URL is a place in
      // this hive, and PasteUrlNavigateBehavior (further down) is its owner.
      // Absolute form only: a bare `www.…` line can never be this origin,
      // and resolving it RELATIVE would claim it as ours by accident.
      const ownOrigin = /^https?:\/\//i.test(line) && (() => {
        try { return new URL(line).origin === window.location.origin }
        catch { return false }
      })()
      if (!ownOrigin) {
        EffectBus.emit('link:intake', { url: line })
        this.clear()
        return
      }
    }

    // A dropped resource is a "make THIS" gesture, so the line is a NAME —
    // the same rule `#completeOnEnter` already applies to the dropdown, held
    // one step further down. A video titles itself, and those titles carry
    // characters this bar reads as operators: a leading `~` is remove-cell,
    // so the create never happened and nothing was added; `?`, `&` and `#`
    // truncated the name to a fragment of itself. None of that is grammar the
    // participant typed. A slash line still runs as a command — that one they
    // did type, since the seed strips `/` out.
    //
    // The cost is create-time tagging (`name:tag`) while something is armed:
    // the colon stays in the name instead of persisting a tag. Tagging the new
    // tile is one gesture away; a title silently eaten is not recoverable.
    // Narrow on purpose: ONLY while the line still holds the name the drop put
    // there. The moment the participant types their own, the bar is theirs
    // again and every operator works as it always did — `name:tag` on a
    // dropped image still tags.
    if (
      this.armedResource()
      && !original.trimStart().startsWith('/')
      && this.#seededArmName
      && original.trim() === this.#seededArmName
    ) {
      await this.commitCreateCellInPlace()
      return
    }

    const cleaned = await this.#extractAndPersistTags(original)

    // Update the shell value with cleaned value (tags stripped)
    if (cleaned !== original) {
      this.shell?.setValue(cleaned)
      this.value.set(cleaned)
    }

    let v = cleaned

    // If only tag ops with nothing left, just clear and return
    if (!v.trim()) {
      this.clear()
      return
    }

    // Per-item bracket operators: `+name` creates, `~name` removes (the rest
    // select). Apply those side-effects, then reduce the value to the remaining
    // selection (+ any trailing op) so the normal routing below handles it.
    // No-op (returns the value unchanged) unless a `+`/`~` item is present, so
    // pure `[a,b]` selection and `[a,b]/op` paths are untouched.
    if (isSelectInput(v)) {
      const reduced = await this.#applyBracketItemOps(v)
      if (reduced !== v) {
        if (!reduced.trim()) { this.clear(); return }
        this.shell?.setValue(reduced)
        this.value.set(reduced)
        v = reduced
      }
    }

    // bracket-primitive execution: `[a,b]/op`, `/select[…]`, or `/format[…]`.
    // Bare `[a,b]` (no op) is left for BracketBehavior below.
    if (isSelectExecution(v)) {
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

    // '@' feature attach/detach — `abc@gallery` / `~abc@gallery`. Only consumed
    // when the fragment resolves to a registered behavior; an unknown `@name`
    // falls through to normal handling (so a stray `@` never eats input).
    const targetedKeywords = parseTargetedKeywordsInput(v)
    if (targetedKeywords) {
      const target = this.completions.normalize(targetedKeywords.target)
      if (target) {
        const selection = get('@diamondcoreprocessor.com/SelectionService') as
          { clear(): void; add(label: string): void } | undefined
        if (selection) {
          this.#syncDirection = 'command'
          selection.clear()
          selection.add(target)
          this.#syncDirection = 'idle'
        }
        const queen = get('@diamondcoreprocessor.com/KeywordsQueenBee') as
          { invoke(args: string): Promise<void> | void } | undefined
        await queen?.invoke(targetedKeywords.transcript)
        this.clear()
        return
      }
    }

    const feat = this.#parseFeatureInput(v)
    if (feat) {
      await this.#applyFeatureOps(feat)
      this.clear()
      return
    }

    // check pluggable behaviors before default handling
    const raw = v.trim()
    for (const behavior of this.#behaviors) {
      // Create a synthetic Enter event for match()
      const synth = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      if (behavior.match(synth, raw)) {
        void Promise.resolve(behavior.execute(raw)).then(() => {
          // A bare-bracket selection (`[a, b]`) leaves the tiles selected — echo
          // the active selection in the bar (so it matches click-select and you
          // can chain an op) rather than clearing to empty. Other behaviors clear.
          if (behavior.name === 'bracket') {
            const sel = get('@diamondcoreprocessor.com/SelectionService') as
              { count?: number; selected?: ReadonlySet<string> } | undefined
            if (sel?.count && sel.selected) { this.#collapseToSelect([...sel.selected]); return }
          }
          this.clear()
        })
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

    // Tile creation is a layer-only mutation. Per the architecture
    // doctrine (project_layer_is_primitive) the current layer is the
    // sole source of truth for tile membership.
    //
    // For nested paths like `meals/breakfast/pastries`, every level
    // gains a child: root.children += meals, meals.children += breakfast,
    // breakfast.children += pastries. Build one (segments, cell) tuple
    // per gained level, then commit them in ONE shared importTree cascade
    // — each affected ancestor commits exactly once with the union of
    // changes. The leaf event still drives UI fade-in via cell:added,
    // marked `viaUpdate: true` so the per-event commit listener skips it.
    const baseSegments = (this.lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []
    const events: { cell: string; segments: string[] }[] = []
    const accumulated: string[] = [...baseSegments]
    for (const part of parts) {
      events.push({ cell: part, segments: accumulated.slice() })
      accumulated.push(part)
    }

    const leafCell = parts[parts.length - 1]
    const armed = this.armedResource()

    if (armed) {
      // Lock substrate out of this cell until the resource is fully attached.
      // The lock is released by ResourceAttachDrone once the props blob is
      // written to OPFS and the tile-props-index is updated.
      EffectBus.emit('cell:attach-pending', { cell: leafCell, pending: true })
    }

    // UI subscribers (show-cell incremental render, activity log,
    // substrate trigger) need the cell:added event BEFORE the commit
    // so the visual mount happens immediately — the layer cascade can
    // take a tick to settle and gating the render on it makes creates
    // feel laggy. `viaUpdate: true` tells the LayerCommitter listener
    // to skip queueing because the upcoming importTree IS the commit.
    for (const evt of events) {
      EffectBus.emit('cell:added', { ...evt, viaUpdate: true })
    }

    // ONE atomic cascade: importTree commits every affected ancestor
    // exactly once. For `a/b/c` from root that's 1 marker each in root,
    // /a, /a/b, /a/b/c — never N markers per level.
    const committer = (window as unknown as { ioc: { get(key: string): unknown } }).ioc.get(
      '@diamondcoreprocessor.com/LayerCommitter',
    ) as {
      importTree?: (
        updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
      ) => Promise<void>
    } | undefined
    if (committer?.importTree) {
      const updates = events.map(evt => ({
        segments: [...evt.segments, evt.cell],
        layer: { name: evt.cell },
      }))
      await committer.importTree(updates)
    }

    if (armed) {
      EffectBus.emit('cell:attach-resource', {
        cell: leafCell,
        largeSig: armed.largeSig,
        smallPointSig: armed.smallPointSig,
        smallFlatSig: armed.smallFlatSig,
        url: armed.url,
        type: armed.type,
        attachment: armed.attachment ?? null,
        atTop: armed.atTop === true,
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

    // Unknown command → the documented create-goto built-in (`/name`
    // creates the cell and navigates into it). Swallowing unknown slash
    // input silently left the user on the CURRENT layer while they
    // believed they had navigated — every follow-up create then landed
    // in the wrong layer.
    if (drone?.has && !drone.has(commandName)) {
      await this.commitCreateCellInPlace()
      return
    }

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
    const labels = inner.split(',').map(s => this.#parseSelectionItem(s)).filter(Boolean)
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

    // `[a,b]:tag` / `[a,b]:[t1, ~t2]` — tag the whole selection. The tag spec
    // after the colon is handed straight to KeywordQueenBee (it understands
    // `tag`, `~tag`, and the `[t1, ~t2]` batch form).
    if (afterBracket.startsWith(':')) {
      const tagSpec = afterBracket.slice(1).trim()
      if (tagSpec) {
        const queen = get('@diamondcoreprocessor.com/KeywordQueenBee') as any
        if (queen?.invoke) await queen.invoke(tagSpec)
      }
      this.#collapseToSelect(labels)
      return
    }

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
      const dir = await this.lineage.explorerDir()
      await this.#removeLabels(labels)
      selection.clear()
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

    // ANY OTHER OP → the behaviour registry. The branches above exist only
    // because they parse bespoke arguments (`/move(8)`, `/move[swap]`,
    // `:tags`); everything else is a plain behaviour and must not need a
    // branch here to be reachable.
    //
    // Without this the if-chain simply fell through to "no operation" and
    // collapsed to a bare select — which is why `[item]/atomize` did NOTHING.
    // The selection was made, the behaviour never ran, and nothing reported a
    // problem. A hardcoded op list in the PARSER (SELECT_OPS, now isSelectOp)
    // and a second one in the EXECUTOR both had to know a command's name; the
    // registry is the only thing that actually does.
    if (op) {
      const slash = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
        { has?: (n: string) => boolean; execute?: (n: string, args: string) => unknown } | undefined
      if (slash?.has?.(op) && slash.execute) {
        // The tiles are already selected above, which is the contract a
        // selection-driven behaviour reads (AtomizeProvider, etc.).
        const args = afterBracket.slice(opMatch![0].length).trim()
        await slash.execute(op, args)
        this.#collapseToSelect(labels)
        return
      }
    }

    // No operation — just /select[tiles] → select and show in bar
    this.#collapseToSelect(labels)
  }

  // -------------------------------------------------
  // per-item bracket operators  ( +create  ~remove )
  // -------------------------------------------------

  /**
   * Apply `+name` (create) and `~name` (remove) per-item operators inside a
   * leading bracket, then return the value reduced to the remaining selection
   * (plus any trailing op). The bracket is multi-purpose: in a PURE bracket
   * (no trailing op) a bare name that does not exist at this level CREATES it,
   * so `[Monday, Tuesday, Wednesday]` mints an array of tiles in one atomic
   * commit and selects them, and a bare PATH item is an add-at-depth gesture —
   * `[abc, hello/world]` mints on multiple levels at once (no quoting; each
   * comma-separated item is a path and/or leaf). Bare single names that
   * already exist keep pure-selection semantics, as does any `[a,b]/op` form
   * (ops never create their operands).
   * Returns the input UNCHANGED when nothing is created or removed, so pure
   * existing-name selection is never disturbed. Returns `''` when only
   * creates/removes were requested (nothing left to select). Whole-group
   * `~[…]` is left to RemoveCellBehavior.
   */
  async #applyBracketItemOps(v: string): Promise<string> {
    if (!v.startsWith('[')) {
      if (!BRACKET_CMD_RE.test(v)) return v
      v = normalizeSelectInput(v) // legacy /select[…] | /format[…] → bare
    }
    const open = v.indexOf('[')
    const close = v.indexOf(']')
    if (open !== 0 || close < 0) return v // not a leading, closed bracket

    const inner = v.slice(open + 1, close)
    const trailing = v.slice(close + 1)

    // create-if-missing applies only to the pure bracket — `[x]/remove` on a
    // typo must not mint-then-delete a junk tile
    const pureBracket = trailing.trim() === ''
    const existing = new Set((this.cellNames$() ?? []).map(n => this.completions.normalize(n)))

    const creates: string[][] = []
    const removes: string[] = []
    const keeps: string[] = []
    for (const itemRaw of inner.split(',')) {
      const t = itemRaw.trim()
      if (!t) continue
      if (t.startsWith('+')) {
        const segs = t.slice(1).split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
        if (segs.length) creates.push(segs)
      } else if (t.startsWith('~')) {
        const path = t.slice(1).split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean).join('/')
        if (path) removes.push(path)
      } else if (pureBracket && t.includes('/')) {
        // Nested lineage — a path item adds on multiple levels at once:
        // `[abc, hello/world]` mints `hello` then `hello/world`. Paths are an
        // add-at-depth gesture, so they always route to create (importTree
        // no-ops levels that already exist).
        const segs = t.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
        if (segs.length) creates.push(segs)
        else keeps.push(t)
      } else {
        const normalized = this.completions.normalize(t)
        if (pureBracket && normalized && !existing.has(normalized)) {
          creates.push([normalized])
        } else {
          keeps.push(t)
        }
      }
    }

    // Nothing to do — let the normal select/op routing handle it untouched.
    if (creates.length === 0 && removes.length === 0) return v

    await this.#createPaths(creates)
    await this.#removeLabels(removes)

    // Freshly created tiles join the selection — by their TOP-LEVEL name only.
    // A `/` inside the echoed bracket would be split as a URL segment boundary
    // when BracketBehavior pushes the selection (`/[hello-x` + `world-x]` —
    // phantom paths, empty render), so a nested create selects its visible
    // top-level parent instead of the deep leaf.
    const remaining = [...new Set([...keeps, ...creates.map(segs => segs[0])])]
    if (remaining.length === 0) return ''
    return '[' + remaining.join(',') + ']' + trailing
  }

  /** Create each path (already-normalized segment arrays) under the current
   *  location via one atomic `importTree` cascade — same primitive as plain
   *  cell creation, so nested `+a/b` mints `a` then `a/b` with one marker each. */
  async #createPaths(paths: readonly string[][]): Promise<void> {
    const valid = paths.filter(p => p.length > 0)
    if (valid.length === 0) return
    const baseSegments = (this.lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []
    const committer = get('@diamondcoreprocessor.com/LayerCommitter') as {
      importTree?: (updates: { segments: readonly string[]; layer: { name?: string } }[]) => Promise<void>
    } | undefined

    const updates: { segments: readonly string[]; layer: { name?: string } }[] = []
    const seen = new Set<string>()
    for (const segs of valid) {
      const acc = [...baseSegments]
      for (const part of segs) {
        const full = [...acc, part]
        const key = full.join('/')
        if (!seen.has(key)) {
          seen.add(key)
          EffectBus.emit('cell:added', { cell: part, segments: acc.slice(), viaUpdate: true })
          updates.push({ segments: full, layer: { name: part } })
        }
        acc.push(part)
      }
    }
    if (committer?.importTree && updates.length > 0) await committer.importTree(updates)
    this.requestSynchronize()
  }

  /** Remove each label (a `/`-separated path) under the current location.
   *  Deepest paths first so a child is gone before its ancestor. Shared by the
   *  `[…]/remove` op and the `~name` per-item operator. */
  async #removeLabels(labels: readonly string[]): Promise<void> {
    if (labels.length === 0) return
    const dir = await this.lineage.explorerDir()
    if (!dir) return
    const sorted = [...labels].sort((a, b) => b.split('/').length - a.split('/').length)
    for (const label of sorted) {
      const segments = label.split('/').filter(Boolean)
      const leaf = segments[segments.length - 1]
      let parent: FileSystemDirectoryHandle | null = dir
      for (let i = 0; i < segments.length - 1 && parent; i++) {
        try { parent = await parent.getDirectoryHandle(segments[i], { create: false }) }
        catch { parent = null }
      }
      if (!parent) continue
      try {
        await parent.removeEntry(leaf, { recursive: true })
        EffectBus.emit('cell:removed', { cell: leaf })
      } catch { /* already gone — skip */ }
    }
    await new hypercomb().act()
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

    // ── Pattern 2: bracket selection syntax `[a, b:tag, c]` (canonical;
    //    legacy `/select[…]` / `/format[…]` normalise to it first). ──
    const normalizedInput = normalizeSelectInput(input)
    const selectMatch = normalizedInput.match(/^(\[)(.+?)(\].*)$/)
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
        return cleaned.replace(/^\[\s*\].*$/, '').trim()
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

  /**
   * Persist collected tag ops onto each cell's layer via the decoration
   * primitive. A tag is a decoration of kind `tag` (payload `{ name }`)
   * written through the essentials DecorationService, resolved at runtime
   * via IoC (shared can't import essentials). Colour/name go to the global
   * TagRegistry. `tags:changed` refreshes show-cell's cache + the controls bar.
   */
  async #persistTagOps(ops: TagOp[]): Promise<void> {
    if (ops.length === 0) return
    const decorations = get('@diamondcoreprocessor.com/DecorationService') as {
      addTag(segments: readonly string[], name: string): Promise<string>
      removeTag(segments: readonly string[], name: string): Promise<void>
    } | undefined
    if (!decorations) return
    const registry = get('@hypercomb.social/TagRegistry') as {
      ensureLoaded(): Promise<void>; add(name: string, color?: string): Promise<void>
    } | undefined
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const parentSegments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    const updates: { cell: string; tag: string; color?: string }[] = []
    for (const op of ops) {
      const segments = [...parentSegments, op.label]
      try {
        if (op.remove) {
          await decorations.removeTag(segments, op.tag)
        } else {
          await decorations.addTag(segments, op.tag)
          if (registry) { await registry.ensureLoaded(); await registry.add(op.tag, op.color) }
        }
        updates.push({ cell: op.label, tag: op.tag, color: op.color })
      } catch (err) { console.warn('[command-line] tag op failed for', op.label, err) }
    }
    if (updates.length > 0) EffectBus.emit('tags:changed', { updates })
  }

  /**
   * Parse `abc@gallery` / `~abc@gallery` into a feature op. Returns null
   * (input not consumed) unless the fragment resolves to a behavior actually
   * registered in the VisualBeeRegistry — so a stray `@` never hijacks a
   * create, paste, or any other input.
   */
  #parseFeatureInput(v: string): { target: string; view: string; remove: boolean } | null {
    const trimmed = v.trim()
    const rm = trimmed.match(FEATURE_REMOVE_RE)
    const ad = rm ? null : trimmed.match(FEATURE_RE)
    const m = rm ?? ad
    if (!m) return null
    const target = this.completions.normalize(m[1])
    const view = m[2].trim().toLowerCase()
    if (!target || !view) return null
    const registry = get('@diamondcoreprocessor.com/VisualBeeRegistry') as
      { get(view: string): unknown } | undefined
    if (!registry?.get(view)) return null
    return { target, view, remove: !!rm }
  }

  /**
   * Apply a feature op. The target cell is selected first (guarded against the
   * selection-sync feedback loop), then the behavior is activated through its
   * OWN registered slash command — reusing the feature's correct attach logic
   * (proper decoration payload, verification gate) rather than fabricating a
   * decoration here, exactly as `[a,b]:tag` routes through the keyword queen.
   * A `feature:apply` intent is also emitted as the decoupled extension seam.
   */
  async #applyFeatureOps(op: { target: string; view: string; remove: boolean }): Promise<void> {
    const registry = get('@diamondcoreprocessor.com/VisualBeeRegistry') as
      { get(view: string): { view: string; slashCommand?: string; attachable?: boolean } | undefined } | undefined
    const bee = registry?.get(op.view)
    if (!bee) return

    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const parentSegments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))
    const segments = [...parentSegments, op.target]

    // Select the target so the behaviour's command operates on it.
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { clear(): void; add(label: string): void } | undefined
    if (selection) {
      this.#syncDirection = 'command'
      selection.clear()
      selection.add(op.target)
      this.#syncDirection = 'idle'
    }

    EffectBus.emit('feature:apply', { view: op.view, segments, remove: op.remove })

    if (op.remove) return

    // An ATTACHABLE behaviour is fully installed by the `feature:apply` above
    // (its decoration written at the target). Running its slash command here
    // would be actively wrong: a view bee's bare command TOGGLES the view, so
    // `diagram@slides` flipped the cell you're standing on into slides instead
    // of making `diagram` a deck. The slash fallback is only for behaviours
    // that still need their own authoring pass.
    if (bee.attachable) return

    const slash = (bee.slashCommand ?? '').replace(/^\//, '')
    if (slash) {
      const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
        { execute(name: string, args: string): Promise<void> | void } | undefined
      await drone?.execute(slash, '')
    }
  }

  /** Echo an active selection as the canonical bare bracket `[a, b, c]`
   *  (truncated when long/unfocused). Never the legacy `/select[…]`. */
  #buildSelectValue(labels: readonly string[], truncate: boolean): string {
    if (!truncate) return '[' + labels.join(',') + ']'
    const mapped = labels.map(l => l.length <= 4 ? l : l.slice(0, 3) + '.')
    return '[' + mapped.join(',') + ']'
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

  /** Last value seen by {@link #autoEnterSlashParams} — used to confirm the
   *  user is typing FORWARD toward the command (so deleting the auto-inserted
   *  space doesn't immediately re-insert it). */
  #prevSlashValue = ''

  /**
   * Once the typed input is an exact, unambiguous slash command that takes
   * parameters, append a space so the full parameter list surfaces as the
   * navigable dropdown — no hidden "type a space to see options" step.
   *
   * Guards:
   *  - only on FORWARD typing (new value extends the previous one), so
   *    backspacing the inserted space doesn't loop it back in;
   *  - never when the command is a strict prefix of another command
   *    (`background` ⊂ `backgrounds`) — that's still ambiguous, keep listing
   *    commands;
   *  - only when the command actually has completions.
   * The trailing space is inert for execution (`/backdrop ` still runs with no
   * arg on Enter), so this only ever reveals options, never changes behaviour.
   */
  #autoEnterSlashParams(v: string): void {
    const prev = this.#prevSlashValue
    this.#prevSlashValue = v
    if (!(v.startsWith(prev) && v.length > prev.length)) return
    const m = v.match(/^\/(\S+)$/)
    if (!m) return
    const command = m[1].toLowerCase()
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as {
      all?(): { name: string }[]; complete?(behaviourName: string, args: string): readonly string[]
    } | undefined
    if (!drone?.all || !drone.complete) return
    const names = drone.all().map(b => b.name.toLowerCase())
    if (!names.includes(command)) return
    if (names.some(n => n !== command && n.startsWith(command))) return
    let hasParams = false
    try { hasParams = drone.complete(command, '').length > 0 } catch { /* none */ }
    if (!hasParams) return
    const next = v + ' '
    this.#prevSlashValue = next
    this.#setShellValue(next, false)
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
    const afterClose = bracketClose >= 0 ? v.slice(bracketClose + 1) : ''
    const hasSuffix = afterClose.startsWith('/') || afterClose.startsWith(':')
    if (hasSuffix && labels.length > 0) {
      this.#collapseToSelect(labels)
    } else {
      this.clear()
    }
  }

  // -------------------------------------------------
  // completion logic
  // -------------------------------------------------

  /**
   * Bridge: shell asked to accept the highlighted suggestion from the keyboard
   * (Tab / ArrowRight). Resolved HERE, against the live computed, because the
   * shell's copy of the list lags a change-detection cycle behind the input —
   * accepting from that lagging copy is what made fast typing complete the
   * wrong thing. `index` is the highlighted row; it is clamped rather than
   * trusted, since it too was chosen against the previous list.
   */
  public onShellAcceptRequested = (index: number): void => {
    const list = this.suggestions()
    if (!list.length) return
    const best = list[index] ?? list[0]
    if (best) this.onShellCompletionAccepted(best)
  }

  /** Bridge: shell accepted a suggestion (keyboard resolution above, or click). */
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
        // Accepting a command that takes parameters drops straight into its
        // parameter list (append a space, keep the dropdown open) — same
        // seamless flow as typing the command out in full.
        const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
          { complete?(behaviourName: string, args: string): readonly string[] } | undefined
        let hasParams = false
        try { hasParams = (drone?.complete?.(best, '')?.length ?? 0) > 0 } catch { /* none */ }
        this.#setShellValue('/' + best + (hasParams ? ' ' : ''), !hasParams)
      } else {
        this.#setShellValue(ctx.head + best, false)
      }
      return
    }

    // '@' feature mode: keep the `cell@` (or `~cell@`) head and append the
    // chosen behavior name. Without this branch it falls through to the bare
    // fallback below, which replaces the whole input with just the feature
    // name — dropping the target cell (typed `diagrams@slides`, Tab left only
    // `slides`).
    if (ctx.mode === 'feature') {
      this.#setShellValue(ctx.head + best, true)
      return
    }

    // select mode: completion depends on phase
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()
      const raw = this.value()

      if (phase === 'selection') {
        const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('['))
        const before = raw.slice(0, lastSep + 1)
        // Preserve a leading per-item operator (`+`/`~`) on the fragment being
        // completed so accepting a suggestion keeps the create/remove intent.
        const fragment = raw.slice(lastSep + 1).trimStart()
        const op = (fragment.startsWith('+') || fragment.startsWith('~')) ? fragment[0] : ''
        const spacer = raw.lastIndexOf(',') >= 0 ? ' ' : ''
        this.#syncDirection = 'command'
        this.#setShellValue(before + spacer + op + best, false)
        this.#syncDirection = 'idle'
        return
      }

      if (phase === 'tag') {
        // ctx.head already includes `]:`, any prior tags, and a leading `~`.
        this.#setShellValue(ctx.head + best, false)
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
      return
    }

    // sub-path mode: rebuild the full path with the accepted child name
    if (subPath.length > 0) {
      const pathPrefix = subPath.join('/') + '/'
      this.#setShellValue(pathPrefix + best + '/', false)
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

  /** Focus the shell, retrying across the frames where something else may
   *  reclaim it. `select` keeps a range highlighted through the whole ladder —
   *  placing the caret at the end on any retry would silently drop the
   *  selection a moment after the participant saw it. */
  #focusShellSoon(select?: [number, number]): void {
    const focus = (): void => {
      this.shell?.unsuppress()
      this.shell?.focus()
      if (select) this.shell?.selectRange(select[0], select[1])
      else this.shell?.placeCaretAtEnd()
    }
    focus()
    queueMicrotask(focus)
    requestAnimationFrame(focus)
    setTimeout(focus, 60)
  }

  private readonly clear = (): void => {
    const wasCapturing = this.#captureMode()
    this.shell?.clear()
    this.value.set('')
    this.#captureMode.set(null)
    if (wasCapturing) {
      EffectBus.emit('command:exit-mode', { mode: 'note-capture', target: wasCapturing.target })
    }
    // sub-path/leaf follow `value()` — clearing it resets them, and the
    // #pathContext effect re-queries the provider at the root level.
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
  #selectPhase = computed<'none' | 'selection' | 'operation' | 'tag' | 'move-path' | 'move-target-index' | 'move-target-swap'>(() => {
    const v = this.value()
    if (!isSelectInput(v)) return 'none'
    return this.#deriveSelectPhase(normalizeSelectInput(v))
  })

  /** Strip :tag(color) suffix from a raw select item, returning just the tile label. */
  #stripTagSuffix(raw: string): string {
    const colon = raw.indexOf(':')
    return colon >= 0 ? raw.slice(0, colon) : raw
  }

  /** Parse one bracket item — supports path syntax `parent/child`. Returns the
   *  normalized path (segments joined by `/`). Empty if the item normalizes
   *  to nothing. */
  #parseSelectionItem(raw: string): string {
    return this.#stripTagSuffix(raw.trim())
      .split('/')
      .map(seg => this.completions.normalize(seg.trim()))
      .filter(Boolean)
      .join('/')
  }

  /** Labels derived from value — computed. During selection phase, only includes
   *  committed labels (before last comma) + the current partial IFF it exactly
   *  matches a cell name. Each label may be a `/`-separated path. */
  #selectLabels = computed<readonly string[]>(() => {
    const v = normalizeSelectInput(this.value())
    if (!v.startsWith('[')) return []
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')
    // Bracket closed — parse full list
    if (bracketClose >= 0) {
      const inner = v.slice(bracketOpen + 1, bracketClose)
      return inner.split(',').map(s => this.#parseSelectionItem(s)).filter(Boolean)
    }
    // Bracket still open (selection phase) — committed labels (before last comma)
    // plus current partial only if its leaf segment exactly matches a known cell name
    const body = v.slice(bracketOpen + 1)
    const allParts = body.split(',').map(s => this.#parseSelectionItem(s)).filter(Boolean)
    if (allParts.length === 0) return []
    const committed = allParts.slice(0, -1)
    const partial = allParts[allParts.length - 1]
    const partialLeaf = partial.includes('/') ? partial.slice(partial.lastIndexOf('/') + 1) : partial
    const cells = new Set(this.cellNames$())
    if (cells.has(partialLeaf)) return allParts
    return committed
  })


  /** Excluded items derived from value — computed */
  #selectExcluded = computed<ReadonlySet<string>>(() => {
    const v = normalizeSelectInput(this.value())
    if (!v.startsWith('[')) return new Set<string>()
    const bracketClose = v.indexOf(']')
    if (bracketClose >= 0) return new Set<string>() // brackets closed, no exclusion needed
    const body = v.slice(v.indexOf('[') + 1)
    const lastComma = body.lastIndexOf(',')
    if (lastComma < 0) return new Set<string>()
    const already = new Set<string>()
    for (const item of body.slice(0, lastComma).split(',')) {
      const n = this.#parseSelectionItem(item)
      if (n) already.add(n)
    }
    return already
  })

  /** Derive the select phase from the input string (pure, no side effects) */
  #deriveSelectPhase(v: string): 'selection' | 'operation' | 'tag' | 'move-path' | 'move-target-index' | 'move-target-swap' {
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')

    if (bracketClose < 0) return 'selection'

    const afterBracket = v.slice(bracketClose + 1)
    if (!afterBracket || afterBracket === '/') return 'operation'
    // `[a,b]:tag` — colon after the bracket tags the selection. This is its OWN
    // phase (not operation), so intellisense shows tag names + a tag ghost, not
    // the `/op` slash.
    if (afterBracket.startsWith(':')) return 'tag'

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
      let raw = lastSep === -1 ? body : body.slice(lastSep + 1).trimStart()
      // Strip a leading per-item operator (`+`create / `~`remove) so cell
      // suggestions match the name being typed; the operator stays in `head`.
      if (raw.startsWith('+') || raw.startsWith('~')) raw = raw.slice(1)
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

    // Phase: tag — `[a,b]:tag` / `[a,b]:t1,t2` / `[a,b]:[t1, ~t2]`. The fragment
    // being typed is whatever follows the last separator (the `:`, a `,`, or a
    // batch-opening `[`); a leading `~` (remove) is kept in `head`.
    if (phase === 'tag') {
      const sepIdx = Math.max(afterBracket.lastIndexOf(':'), afterBracket.lastIndexOf(','), afterBracket.lastIndexOf('['))
      let raw = afterBracket.slice(sepIdx + 1).trimStart()
      if (raw.startsWith('~')) raw = raw.slice(1)
      const head = v.slice(0, v.length - raw.length)
      return { active: true, mode: 'select', head, raw, normalized: raw.toLowerCase().trim(), style: 'space' }
    }

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
  #bracketPhase = computed<'none' | 'items' | 'path'>(() => this.#pathContext().bracketPhase)
  /** Whether current bracket mode is colon-bracket (cell:[...]) — items are plain tag names. */
  get #colonBracketMode(): boolean { return this.#pathContext().colonBracket }
  /** Pending tag adds/removes typed in the current bracket input (not yet persisted). */
  get #bracketPendingTags(): { adds: ReadonlySet<string>; removes: ReadonlySet<string> } {
    return this.#pathContext().pendingTags
  }

  /**
   * Load a cell's existing tags into the cache signal. Folder-based
   * tag storage retired — until layer-slot tag reads are wired, cells
   * appear tagless to the bracket-pending UI.
   */
  async #loadCellTags(_label: string): Promise<void> {
    this.#bracketCellTags.set(new Set())
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

  /**
   * Everything the completion machinery needs to know about WHERE the input
   * is pointing, parsed fresh from `value()` on every read. Pure — no signal
   * writes, no provider calls, no tag loads; the side effects live in
   * `#pathSideEffects` below so this can be read from computeds (ghost text,
   * suggestions) and from the Tab accept handler with identical results.
   */
  readonly #pathContext = computed<PathContext>(() => this.#parsePath(this.value()))

  /**
   * The side of path tracking that has to reach out: ask the provider for the
   * cells at the current depth, and load the target cell's tags in bracket-tag
   * mode. Driven by the derived context, so it fires for EVERY value change
   * regardless of which code path produced it.
   */
  readonly #pathSideEffects = effect(() => {
    const ctx = this.#pathContext()
    this.cellProvider.query(ctx.subPath)
    if (ctx.tagLabel) {
      if (ctx.tagLabel !== this.#bracketCellLabel) {
        this.#bracketCellLabel = ctx.tagLabel
        void this.#loadCellTags(ctx.tagLabel)
      }
    } else if (this.#bracketCellLabel) {
      this.#bracketCellLabel = ''
      this.#bracketCellTags.set(new Set())
    }
  })

  #parsePath(rawValue: string): PathContext {
    const raw = rawValue.trim()
    const none: PathContext = {
      bracketPhase: 'none',
      colonBracket: false,
      subPath: [],
      leaf: '',
      tagLabel: '',
      pendingTags: EMPTY_PENDING_TAGS,
    }

    // detect bracket mode: [items]/path
    const bracketOpen = raw.indexOf('[')
    const bracketClose = raw.indexOf(']')

    if (bracketOpen >= 0 && bracketClose < 0) {
      // inside brackets — suggest current surface tiles or tags
      const inner = raw.slice(bracketOpen + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trim() : inner.trim()
      const committed = lastComma >= 0 ? inner.slice(0, lastComma) : ''

      // Detect cell:[...] colon-bracket tag mode: colon immediately before '['
      const isColonBracket = bracketOpen > 0 && raw[bracketOpen - 1] === ':'

      if (isColonBracket) {
        // ALL items in cell:[...] are tags — no : prefix needed
        return {
          bracketPhase: 'items',
          colonBracket: true,
          subPath: [],
          // Use ~ prefix to signal removal mode, otherwise raw fragment for add mode
          leaf: fragment.startsWith('~') ? '~:' + fragment.slice(1) : ':' + fragment,
          tagLabel: this.completions.normalize(raw.slice(0, bracketOpen - 1).trim()),
          pendingTags: this.#parseBracketTagItems(committed),
        }
      }

      // Legacy colon-prefixed fragment → tag mode (e.g. abc[:tag])
      if (fragment.startsWith(':') || fragment.startsWith('~:')) {
        return {
          bracketPhase: 'items',
          colonBracket: false,
          subPath: [],
          leaf: fragment,
          tagLabel: bracketOpen > 0 ? this.completions.normalize(raw.slice(0, bracketOpen).trim()) : '',
          pendingTags: this.#parsePendingBracketTags(committed),
        }
      }

      // plain cell items — no tag context
      return {
        ...none,
        bracketPhase: 'items',
        leaf: this.completions.normalize(fragment),
      }
    }

    if (bracketOpen === 0 && bracketClose > 0 && bracketClose < raw.length - 1 && raw[bracketClose + 1] === '/') {
      // after bracket-path — suggest relative subfolders
      const clean = raw.slice(bracketClose + 2).replace(/\/+$/, '') // after ]/
      if (!clean.includes('/')) {
        // single level: leaf is the typed fragment, query at current level
        return { ...none, bracketPhase: 'path', leaf: this.completions.normalize(clean) }
      }
      const { subPath, leaf } = this.#splitPath(clean)
      return { ...none, bracketPhase: 'path', subPath, leaf }
    }

    // default: no bracket mode. Strip leading '/' (create-goto prefix).
    const clean = raw.replace(/^\/+/, '')

    // no '/' means we're at the current level
    if (!clean.includes('/')) return none

    return { ...none, ...this.#splitPath(clean) }
  }

  /** Everything before the last '/' is the sub-path; the last segment
   *  (possibly empty after a trailing '/') is the leaf filter. */
  #splitPath(clean: string): { subPath: readonly string[]; leaf: string } {
    const parts = clean.split('/')
    const leaf = this.completions.normalize((parts.pop() ?? '').trim())
    const subPath = parts.map(p => this.completions.normalize(p.trim())).filter(Boolean)
    return { subPath, leaf }
  }
}

/** Where the command-line input is pointing — see CommandLineComponent#pathContext. */
type PathContext = {
  bracketPhase: 'none' | 'items' | 'path'
  colonBracket: boolean
  subPath: readonly string[]
  leaf: string
  /** Cell whose existing tags feed bracket-tag intellisense ('' = not in tag mode). */
  tagLabel: string
  pendingTags: { adds: ReadonlySet<string>; removes: ReadonlySet<string> }
}

const EMPTY_PENDING_TAGS: { adds: ReadonlySet<string>; removes: ReadonlySet<string> } = {
  adds: new Set<string>(),
  removes: new Set<string>(),
}

// Tag props helpers now imported from @hypercomb/shared/core/tag-ops
