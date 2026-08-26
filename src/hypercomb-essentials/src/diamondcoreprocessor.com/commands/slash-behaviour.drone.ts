// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.drone.ts
import { EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
// The name + bouquet registries ride the commands bundle — exactly ONE entry
// imports them (two importers would inline two instances; ioc is first-wins).
import './name-registry.js'
import './bouquet-registry.js'
import './tag-registry.js'
// The launch-group cluster (registry, mixed bag, aggregation layer, built-in
// groups) rides this bundle too — launch-groups pulls the whole chain.
import '../groups/launch-groups.js'
import './view-mode.service.js'
import './resource-completion.service.js'
import './voice-input.service.js'
import './cell-suggestion.provider.js'
// The website-mode Escape safety net rides this bundle, beside the ViewMode
// service it guards. ONE importer: dup-inlining rule.
import './website-nav.view.js'
// The confirm modal rides this bundle: callers reach it from every domain
// (remove, prune, link-drop), so it belongs to the one that is always up.
import './confirm-dialog.view.js'
import { ReceiptBuilder, describeReceipt } from '../assistant/receipt.js'
import { BREAK_APART_SKIP_LABELS } from '../assistant/break-apart.drone.js'
import type { SlashBehaviour, SlashBehaviourMatch, SlashBehaviourProvider } from './slash-behaviour.provider.js'

export class SlashBehaviourDrone extends EventTarget {
  #providers: SlashBehaviourProvider[] = []

  addProvider(provider: SlashBehaviourProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
  }

  all(): SlashBehaviour[] {
    const results: SlashBehaviour[] = []
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour)
        results.push(localized)
        for (const alias of behaviour.aliases ?? []) {
          results.push({ ...localized, name: alias })
        }
      }
    }
    return results
  }

  /** Primary behaviours only (aliases preserved on each entry's `aliases` field). */
  entries(): SlashBehaviour[] {
    return this.#providers.flatMap(p => p.behaviours).map(b => this.#localize(b))
  }

  match(query: string): SlashBehaviourMatch[] {
    const q = query.toLowerCase().trim()
    const results: SlashBehaviourMatch[] = []

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        // Behaviours flagged hidden are still invokable via execute()
        // but never surface in autocomplete suggestions. Used for
        // destructive / dev-only commands the user must type in full.
        if (behaviour.hidden) continue
        const localized = this.#localize(behaviour)
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]

        for (const name of names) {
          if (!q || name.startsWith(q)) {
            // each matching name (primary or alias) becomes its own entry
            // so autocomplete sees every reachable name, not just the primary
            results.push({
              behaviour: name === behaviour.name
                ? localized
                : { ...localized, name },
              provider,
            })
          }
        }
      }
    }

    return results
  }

  #localize(behaviour: SlashBehaviour): SlashBehaviour {
    if (!behaviour.descriptionKey) return behaviour
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) return behaviour
    const translated = i18n.t(behaviour.descriptionKey)
    if (translated === behaviour.descriptionKey) return behaviour
    return { ...behaviour, description: translated }
  }

  complete(behaviourName: string, args: string): readonly string[] {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name) && provider.complete) {
          return provider.complete(behaviour.name, args)
        }
      }
    }
    return []
  }

  execute(behaviourName: string, args: string): Promise<void> | void {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name)) {
          return provider.execute(behaviour.name, args)
        }
      }
    }
  }

  /** True when some provider (manual or auto-wrapped queen) claims the
   *  command name or one of its aliases. The command line uses this to
   *  route unknown `/name` input to the create-goto built-in instead of
   *  swallowing it. */
  has(behaviourName: string): boolean {
    const name = behaviourName.toLowerCase().trim()
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        if ([behaviour.name, ...(behaviour.aliases ?? [])].includes(name)) return true
      }
    }
    return false
  }
}

// ── starter providers ───────────────────────────────────

class HelpProvider implements SlashBehaviourProvider {
  readonly name = 'help-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'help', description: 'Show reference', descriptionKey: 'slash.help',
      examples: [{ input: '/help', result: 'Opens the keyboard shortcut reference sheet' }] }
  ]

  execute(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'ui.shortcutSheet', binding: null, event: null })
  }
}

class ClearProvider implements SlashBehaviourProvider {
  readonly name = 'clear-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'clear', description: 'Clear active filter', descriptionKey: 'slash.clear',
      examples: [{ input: '/clear', result: 'Clears the active search filter so all tiles show' }] }
  ]

  execute(): void {
    EffectBus.emit('search:filter', { keyword: '' })
    void new hypercomb().act()
  }
}

class KeywordProvider implements SlashBehaviourProvider {
  readonly name = 'keyword-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'keyword', description: 'Add or remove keywords (tags) on selected tiles', descriptionKey: 'slash.keyword',
      options: ['<tag>', '<tag>(#hexcolor)', '~<tag>', '[<tag>, ~<tag>, ...]'],
      examples: [
        { input: '/keyword urgent', result: 'Tags the selected tiles with "urgent"' },
        { input: '/keyword ~urgent', result: 'Removes the "urgent" tag from the selected tiles' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/KeywordQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
    const tagNames = registry?.names ?? []
    const q = args.toLowerCase().trim()
    // strip leading ~ (remove prefix) for matching
    const prefix = q.startsWith('~') ? q.slice(1) : q
    if (!prefix) return tagNames
    return tagNames.filter(t => t.toLowerCase().startsWith(prefix))
  }
}

// DebugProvider removed — DebugQueenBee carries its own description,
// descriptionKey and examples, so auto-discovery below wraps it directly.
// A manual provider that only forwards to `queen.invoke` is pure drift risk.

class RemoveProvider implements SlashBehaviourProvider {
  readonly name = 'remove-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'remove', description: 'Remove tiles from the current directory', descriptionKey: 'slash.remove',
      options: ['<tile name>', '[<tile>, <tile>, ...]'],
      examples: [
        { input: '/remove drafts', result: 'Removes the tile named "drafts" from the current directory' },
        { input: '/remove', result: 'Removes the currently selected tiles' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/RemoveQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const cellProvider = get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined
    const cells = cellProvider?.suggestions() ?? []

    // Bracket mode: /remove[cell1,cell2,partial
    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const inner = args.slice(bracketStart + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
      const already = new Set<string>()
      for (const item of inner.split(',')) {
        const n = item.trim().toLowerCase()
        if (n && n !== fragment) already.add(n)
      }
      let filtered = cells.filter(n => !already.has(n))
      if (fragment) filtered = filtered.filter(n => n.startsWith(fragment))
      return filtered
    }

    // Space mode
    const q = args.toLowerCase().trim()
    if (!q) return cells
    return cells.filter(n => n.startsWith(q))
  }
}

class AccentProvider implements SlashBehaviourProvider {
  readonly name = 'accent-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'accent', description: 'Set the hover accent color by name', descriptionKey: 'slash.accent',
      options: ['glacier', 'bloom', 'aurora', 'ember', 'nebula', '<tag> <preset>', '[<tag>, <tag>] <preset>', '~<tag>'],
      examples: [
        { input: '/accent ember', result: 'Sets the default hover accent to ember' },
        { input: '/accent education aurora', result: 'Tiles tagged "education" glow aurora on hover' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/AccentQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const presets = ['glacier', 'bloom', 'aurora', 'ember', 'nebula']
    const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
    const tagNames = registry?.names ?? []

    // Bracket mode: /accent[tag1,tag2,partial
    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const bracketClose = args.indexOf(']', bracketStart)
      if (bracketClose < 0) {
        // Inside brackets — suggest tag names, exclude already chosen
        const inner = args.slice(bracketStart + 1)
        const lastComma = inner.lastIndexOf(',')
        const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
        const already = new Set<string>()
        for (const item of inner.split(',')) {
          const n = item.trim().toLowerCase()
          if (n && n !== fragment) already.add(n)
        }
        let tags = tagNames.filter(t => !already.has(t.toLowerCase()))
        if (fragment) tags = tags.filter(t => t.toLowerCase().startsWith(fragment))
        return tags
      }
      // After closed brackets — suggest presets
      const after = args.slice(bracketClose + 1).trimStart().toLowerCase()
      if (!after) return presets
      return presets.filter(p => p.startsWith(after))
    }

    // Space mode: suggest presets + tags
    const all = [...presets, ...tagNames.filter(t => !presets.includes(t))]

    // Two-arg form: first arg done, suggest presets for second
    const parts = args.split(/\s+/)
    if (parts.length >= 2) {
      const q = parts[parts.length - 1].toLowerCase()
      if (!q) return presets
      return presets.filter(p => p.startsWith(q))
    }

    const q = args.toLowerCase().trim()
    if (!q) return all
    return all.filter(n => n.toLowerCase().startsWith(q))
  }
}

class MoveProvider implements SlashBehaviourProvider {
  readonly name = 'move-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'move', description: 'Toggle move mode for drag-reordering tiles', descriptionKey: 'slash.move',
      options: ['(<index>)'],
      examples: [
        { input: '/move', result: 'Toggles drag-reorder move mode' },
        { input: '/move(3)', result: 'Moves the selection to slot 3' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    // /move(index) — commit a move using the current selection
    const indexMatch = args.match(/\((\d+)\)/) || args.match(/\((\d+)$/)
    if (indexMatch) {
      const targetIndex = parseInt(indexMatch[1], 10)
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string> } | undefined
      const labels = selection ? Array.from(selection.selected) : []
      if (labels.length > 0) {
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
          moveDrone.beginCommandMove(labels)
          await moveDrone.commitCommandMoveAt(targetIndex)
        }
      }
      return
    }

    // /move — toggle move mode
    EffectBus.emit('controls:action', { action: 'move' })
  }
}

// BREAK APART — GO DEEPER. Breaks a tile into the pieces that compose it, on
// Claude Haiku's advice, ASKED OVER THE BRIDGE (BreakApartDrone mints a
// `task:'break-apart'` ask — no API key; a bridge-connected session creates
// the parts).
//
// With no selection the drone first asks whether the LAYER is crowded: more
// than a dozen tiles means the page needs a level inserted, so it routes to
// /organize instead. Otherwise the unit is a TILE, applied foreach: selection
// → each selected tile; no selection → each leaf on the current layer.
//
// Not `/atomize-ui`, which toggles the atomizer toolbar — a different
// mechanism that splits dropped input, not this verb. Not `/organize`,
// which goes the OTHER way — mints no leaves, inserts a level and re-homes
// existing children into groups. Not `/expand`, which grows the CURRENT
// layer sideways with new siblings instead of deepening a leaf.
class BreakApartProvider implements SlashBehaviourProvider {
  readonly name = 'break-apart-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'break-apart',
      description: 'Break tiles into the pieces that compose them, via Claude Haiku', descriptionKey: 'slash.break-apart',
      examples: [
        { input: '/break-apart', result: 'With tiles selected: breaks down each selected tile' },
        { input: '/break-apart', result: 'With nothing selected: breaks down every leaf tile on this layer' },
      ] }
  ]

  async execute(_behaviourName: string, _args: string): Promise<void> {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const targets = selection ? Array.from(selection.selected) : []

    // No selection: the drone runs the foreach over the layer's leaves and
    // owns the reporting (it knows what it skipped).
    if (targets.length === 0) {
      EffectBus.emit('break-apart:layer', {})
      return
    }

    const drone = get('@diamondcoreprocessor.com/BreakApartDrone') as
      { breakApartTile?: (label: string) => Promise<string> } | undefined
    if (!drone?.breakApartTile) {
      // Fallback to the quick-menu channel if the drone isn't up yet — it
      // enforces the leaf rule on the same path.
      for (const label of targets) {
        EffectBus.emit('tile:action', { action: 'expand', label, q: 0, r: 0, index: 0 })
      }
      return
    }

    // FOREACH the selection — one ask per tile, each independently
    // answerable and undoable. Mints are serialized inside the drone, which
    // also refuses a tile that already has children and one already queued.
    // Report the REASON, not just the shortfall.
    const receipt = new ReceiptBuilder()
    for (const label of targets) {
      const outcome = await drone.breakApartTile(label)
      if (outcome === 'queued') receipt.landed()
      else receipt.skipped(outcome)
    }

    const r = receipt.build()
    EffectBus.emit('toast:show', {
      type: 'tip',
      message: describeReceipt(r, 'Breaking apart', 'tile', BREAK_APART_SKIP_LABELS)
        + (r.landed ? ' — Haiku is working out the parts.'
           : r.skipped.has('has-children') ? ' Use /organize to group a crowded level.' : ''),
    })
  }
}

// EXPAND — GO WIDER. The third structural verb next to break-apart (deeper) and
// organize (shallower): it asks Claude Haiku over the bridge (ExpandDrone
// mints a `task:'expand'` ask — no API key) to look at what the CURRENT layer
// already holds and CREATE the sibling tiles its subject is still missing.
// The unit is the layer, never a single tile — deepening one tile is
// /break-apart. An optional argument narrows the direction of interest.
class ExpandProvider implements SlashBehaviourProvider {
  readonly name = 'expand-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'expand',
      description: 'Grow this layer with new tiles that extend its subject, via Claude Haiku', descriptionKey: 'slash.expand',
      examples: [
        { input: '/expand', result: 'Haiku looks at this layer\'s tiles and adds the aspects the subject is missing' },
        { input: '/expand growing techniques', result: 'Same, but steered toward the interest you named' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    EffectBus.emit('expand:layer', { focus: args.trim() })
  }
}

// SwirlProvider removed — the index-spiral layout has been phased out.
// Pinned is the only layout mode and cell positions are owned by
// per-cell indices stored in 0000 properties.

// ArrangeProvider removed — same reason as DebugProvider: ArrangeQueenBee
// declares everything the provider was repeating, and auto-discovery wraps it.

class VoiceProvider implements SlashBehaviourProvider {
  readonly name = 'voice-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'voice', description: 'Toggle voice input (speech-to-text)', descriptionKey: 'slash.voice',
      examples: [{ input: '/voice', result: 'Toggles speech-to-text input' }] }
  ]

  async execute(): Promise<void> {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }
}

class PushToTalkProvider implements SlashBehaviourProvider {
  readonly name = 'push-to-talk-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'push-to-talk', description: 'Toggle push-to-talk mic button', descriptionKey: 'slash.push-to-talk',
      examples: [{ input: '/push-to-talk', result: 'Shows or hides the hold-to-talk mic button' }] }
  ]

  async execute(): Promise<void> {
    const current = localStorage.getItem('hc:push-to-talk') === 'true'
    const next = !current
    localStorage.setItem('hc:push-to-talk', String(next))
    EffectBus.emit('push-to-talk:toggle', { enabled: next })
  }
}

class TextOnlyProvider implements SlashBehaviourProvider {
  readonly name = 'text-only-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'text-only', description: 'Toggle text-only mode (hide images)', descriptionKey: 'slash.text-only',
      examples: [{ input: '/text-only', result: 'Tiles render labels only; repeat to restore images' }] }
  ]

  #active = false

  execute(): void {
    this.#active = !this.#active
    EffectBus.emit('render:set-text-only', { textOnly: this.#active })
  }
}

class AtomizeUiProvider implements SlashBehaviourProvider {
  readonly name = 'atomize-ui-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'atomize-ui', description: 'Toggle the atomizer toolbar', descriptionKey: 'slash.atomize-ui',
      examples: [{ input: '/atomize-ui', result: 'Opens the atomizer toolbar' }] }
  ]

  execute(): void {
    EffectBus.emit('atomizer-bar:toggle', { active: true })
  }
}

// ORGANIZE — the inverse of break-apart. Mints no leaves: it inserts a level and
// re-homes the layer's existing children into named groups, so a crowded page
// becomes a handful of groups. Haiku plans the clusters over the bridge; the
// hive performs the moves (OrganizeDrone.applyPlan) because a membership
// rewrite is the one op that can lose a tile.
class OrganizeProvider implements SlashBehaviourProvider {
  readonly name = 'organize-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'organize',
      description: 'Group a crowded layer into subfolders via Claude Haiku', descriptionKey: 'slash.organize',
      options: ['preview', 'apply'],
      examples: [
        { input: '/organize', result: 'Haiku groups this layer\'s tiles; each group becomes a tile they move into' },
        { input: '/organize preview', result: 'Shows the grouping it would make and holds it — nothing moves' },
        { input: '/organize apply', result: 'Runs the plan that /organize preview held' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const arg = args.trim().toLowerCase()

    // PLAN BEFORE APPLY: `preview` validates a real plan against the live
    // layer and reports it without moving anything; `apply` runs the held one.
    if (arg === 'apply') {
      const drone = get('@diamondcoreprocessor.com/OrganizeDrone') as
        { applyHeldPlan?: () => Promise<number> } | undefined
      if (drone?.applyHeldPlan) await drone.applyHeldPlan()
      return
    }

    EffectBus.emit('organize:layer', { preview: arg === 'preview' })
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return ['preview', 'apply'].filter(s => s.startsWith(q))
  }
}

class DocsProvider implements SlashBehaviourProvider {
  readonly name = 'docs-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'docs', description: 'Browse project documentation', descriptionKey: 'slash.docs',
      options: ['<page>'],
      examples: [{ input: '/docs', result: 'Opens the documentation browser' }] }
  ]

  execute(_behaviourName: string, args: string): void {
    EffectBus.emit('docs:open', { page: args.trim() || '' })
  }
}

class DomainProvider implements SlashBehaviourProvider {
  readonly name = 'domain-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'domain', description: 'Add, remove, or list mesh relay domains', descriptionKey: 'slash.domain',
      options: ['<ws:// or wss:// url>', 'remove <url>', 'list', 'clear'],
      examples: [
        { input: '/domain wss://relay.example.com', result: 'Adds the relay domain' },
        { input: '/domain list', result: 'Lists configured relay domains' },
      ] }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DomainQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const subcommands = ['list', 'remove', 'clear']
    const q = args.toLowerCase().trim()
    if (!q) return subcommands
    return subcommands.filter(s => s.startsWith(q))
  }
}

class ObserveProvider implements SlashBehaviourProvider {
  readonly name = 'observe-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'observe', description: 'Observe the swarm — who is here and what they share', descriptionKey: 'slash.observe',
      examples: [{ input: '/observe', result: 'Opens the swarm observe panel' }] }
  ]

  execute(): void {
    EffectBus.emit('observe:toggle', {})
  }
}

// ── registration ────────────────────────────────────────

const _slashBehaviours = new SlashBehaviourDrone()
_slashBehaviours.addProvider(new HelpProvider())
_slashBehaviours.addProvider(new ClearProvider())
_slashBehaviours.addProvider(new KeywordProvider())
_slashBehaviours.addProvider(new RemoveProvider())
_slashBehaviours.addProvider(new AccentProvider())
_slashBehaviours.addProvider(new MoveProvider())
_slashBehaviours.addProvider(new BreakApartProvider())
_slashBehaviours.addProvider(new ExpandProvider())
_slashBehaviours.addProvider(new OrganizeProvider())
_slashBehaviours.addProvider(new VoiceProvider())
_slashBehaviours.addProvider(new PushToTalkProvider())
_slashBehaviours.addProvider(new TextOnlyProvider())
_slashBehaviours.addProvider(new AtomizeUiProvider())
_slashBehaviours.addProvider(new DocsProvider())
_slashBehaviours.addProvider(new DomainProvider())
_slashBehaviours.addProvider(new ObserveProvider())

// ── auto-discovery of QueenBees ─────────────────────────
//
// The queen class IS the source of truth. SlashBehaviourDrone auto-wraps
// any registered QueenBee into a provider at call time, reading fields
// live from the queen instance — so there is no way for a provider to
// drift out of sync with its queen. New queens don't need a mirror class;
// they just register in IoC.
//
// Precedence: manual providers (above) win if they declare the same command
// name. This lets legacy queens keep their manual provider until migrated.

const autoWrappedCommands = new Set<string>()

const isQueen = (value: unknown): value is {
  command: string
  aliases?: readonly string[]
  description?: string
  descriptionKey?: string
  slashHidden?: boolean
  invoke: (args: string) => Promise<void> | void
  slashComplete?: (args: string) => readonly string[]
} => {
  return !!value
    && typeof (value as any).command === 'string'
    && typeof (value as any).invoke === 'function'
}

const alreadyDeclared = (command: string): boolean => {
  return _slashBehaviours.all().some(b => b.name === command)
}

const wrapQueen = (queen: ReturnType<typeof isQueen> extends true ? never : any): SlashBehaviourProvider => ({
  name: `auto-${queen.command}`,
  priority: 50, // below manual providers — they win on command-name ties
  behaviours: [{
    name: queen.command,
    description: queen.description ?? queen.command,
    descriptionKey: queen.descriptionKey,
    aliases: queen.aliases ?? [],
    hidden: queen.slashHidden === true,
    // Structured usage docs (QueenBee.options / .examples) ride through so
    // every reference surface gets them without parsing descriptions.
    options: queen.options,
    examples: queen.examples,
  }],
  execute(_behaviourName: string, args: string): Promise<void> | void {
    return queen.invoke(args)
  },
  complete: typeof queen.slashComplete === 'function'
    ? (_behaviourName: string, args: string) => queen.slashComplete(args)
    : undefined,
} as SlashBehaviourProvider)

const considerQueen = (value: unknown): void => {
  if (!isQueen(value)) return
  if ((value as any).slashSkipAutoWrap === true) return
  if (autoWrappedCommands.has(value.command)) return
  if (alreadyDeclared(value.command)) return
  autoWrappedCommands.add(value.command)
  _slashBehaviours.addProvider(wrapQueen(value))
}

// Scan queens that registered before the drone itself was set up.
for (const key of window.ioc.list()) {
  considerQueen(window.ioc.get(key))
}

// Subscribe to future registrations so dynamically-loaded queens auto-wire too.
window.ioc.onRegister((_key, value) => considerQueen(value))
window.ioc.register('@diamondcoreprocessor.com/SlashBehaviourDrone', _slashBehaviours)
