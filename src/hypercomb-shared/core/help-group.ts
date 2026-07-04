// hypercomb-shared/core/help-group.ts
//
// The "help" launch group — the app's ACTIONS laid out as tiles. Clicking the
// help icon fills the launcher page with one plain hexagon tile per keymap
// action (the same live introspection the /help sheet reads), plus a leading
// "Reference" tile that opens the classic shortcut-sheet overlay — the
// existing popup, surfaced as one tile operation among the rest.
//
// Help tiles are DOCUMENTATION, so they follow the contact-card interaction
// exactly: HOVER a tile and the action's study card peeks (what it does, its
// shortcut, its category — fed by ActionCardDrone over EffectBus); CLICK the
// tile and the card PINS like a contact card — drag several apart to compare
// and study. Executing lives on the card's Run button, which fires the same
// `keymap:invoke { cmd }` the keyboard and command palette use.
//
// Members are discovered from KeyMapService at call time (resolved through
// window.ioc, never imported — shell code must not depend on essentials).
// Until the keymap registers, the group still surfaces the Reference tile,
// so help is ALWAYS available; whenReady re-renders the launcher once the
// actions arrive. A rebound key re-renders with its new combo, a community
// binding gets a tile for free — no roster here.

import { EffectBus, type KeyBinding } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'

/** The classic /help reference sheet, as one tile among the actions. Tapping
 *  it toggles the overlay via the same keymap command `/` and /help use —
 *  ShortcutSheetDrone stays the one owner of open/close state. */
const SHEET_MEMBER: GroupMember = { key: 'ui.shortcutSheet', label: 'Reference', segments: [], icon: 'menu_book' }

/** Curated tile names — binding descriptions are sentences ("Arrange tiles
 *  by the next sequence"); a tile wants a word. Unknown cmds fall back to
 *  their description, so runtime-registered bindings still get a tile. */
const ACTION_LABELS: Record<string, string> = {
  'ui.commandPalette': 'Palette',
  'ui.commandLineToggle': 'Command Line',
  'render.togglePivot': 'Orientation',
  'render.toggleBees': 'Bees',
  'screensaver.show': 'Screensaver',
  'mesh.togglePublic': 'Public Mode',
  'navigation.moveUp': 'Up',
  'navigation.moveDown': 'Down',
  'navigation.moveLeft': 'Left',
  'navigation.moveRight': 'Right',
  'navigation.fitToScreen': 'Fit',
  'navigation.recenter': 'Center',
  'clipboard.copy': 'Copy',
  'clipboard.paste': 'Paste',
  'layout.cutCells': 'Cut',
  'sequence.cycle': 'Arrange',
  'sequence.cyclePrev': 'Arrange Back',
  'selection.toggleLeader': 'Leader',
  'selection.remove': 'Remove',
  'tile.editHovered': 'Edit',
  'history.undo': 'Undo',
  'history.redo': 'Redo',
  'history.toggle-scope': 'Time Scope',
  'history.exit-revise': 'Exit Revise',
}

/** Category order on the page — movement first, then the editing verbs, then
 *  the view/mesh toggles; slash behaviours and command-line operations follow
 *  as their own clusters; anything uncategorized lands last. The Reference
 *  tile leads the grid regardless. */
const CATEGORY_ORDER = ['Navigation', 'Clipboard', 'Selection', 'Editing', 'Tiles', 'History', 'View', 'Mesh', 'Slash', 'Command Line']

/** Header tile labels that differ from the raw category — to avoid colliding
 *  with an ACTION tile of the same name. The 'Command Line' category (its typed
 *  input behaviours) would otherwise clash with the command-line toggle action,
 *  suffixing the header "Command Line (2)". */
const HEADER_LABELS: Record<string, string> = { 'Command Line': 'Command Bar' }

/** A category with more than this many tiles splits into alphabetical
 *  sub-islands, so one big group (Slash, ~60 commands) doesn't dwarf the 2–6
 *  tile categories. */
const MAX_ISLAND = 16

/** Commands that make no sense as a tile. Escape's whole meaning is "leave
 *  the current surface"; the sheet is added explicitly (SHEET_MEMBER). */
const EXCLUDED_COMMANDS = new Set(['global.escape', 'ui.shortcutSheet'])

/** Slash behaviours that duplicate a tile already on the page. */
const EXCLUDED_SLASH = new Set(['help'])

/** Slash tiles read as their typed form. A REAL '/' can't lead a cell name
 *  (labels travel through path-shaped code), so the fullwidth solidus U+FF0F
 *  stands in — renders as the slash the participant actually types. */
const SLASH_PREFIX = '／'

/** Curated names for the command-line input behaviors — the registry ids are
 *  code-ish ('shift-enter-navigate'); a tile wants the gesture's name. */
const CLI_LABELS: Record<string, string> = {
  'direct-command': 'Direct Commands',
  'tag-assign': 'Tagging',
  'cut-paste': 'Cut & Paste Input',
  'slash-behaviour': 'Slash Input',
  'bracket': 'Brackets',
  'paste-url-navigate': 'Paste URL',
  'remove-cell': 'Remove Input',
  'go-parent': 'Go Up',
  'hash-marker': 'Markers',
  'shift-enter-navigate': 'Navigate Input',
  'create': 'Create Tiles',
  'filter': 'Filter Tiles',
}

type KeyMapLike = { getEffective?: () => KeyBinding[] }
type SlashDroneLike = { entries?: () => { name: string; hidden?: boolean }[] }
type CliMetaLike = readonly { name: string }[]
type IocLike = { whenReady?: (key: string, cb: (v: unknown) => void) => void }

class HelpGroup extends LaunchGroupBase {
  override readonly id = 'help'
  override readonly icon = 'help'
  override readonly label = 'Help'
  /** The help page renders as clustered ISLANDS — one compact hex blob per
   *  category, titled by a header tile — not one continuous spiral. This also
   *  makes the reconcile keep the page in members() order so each header
   *  interleaves directly ahead of its category's tiles. */
  readonly orderedLayout = true

  constructor() {
    super()
    // Actions live in the keymap (an essentials service) and may register
    // after this shell module — re-render the launcher when they arrive.
    // Anything already up is covered by members() enumerating at call time.
    ;(window as unknown as { ioc?: IocLike }).ioc
      ?.whenReady?.('@diamondcoreprocessor.com/KeyMapService', () => groupRegistry.notifyChanged())
  }

  /** The Reference tile + one tile per keymap action + one per slash
   *  behaviour + one per command-line input behavior, in category order.
   *  Same live introspection the sheet uses (KeyMapService,
   *  SlashBehaviourDrone, CommandLineBehaviors), so the page never drifts
   *  from the code — every behavior with usage worth studying gets a tile.
   *  Help never goes empty: the Reference member is static. */
  override members(): GroupMember[] {
    const seen = new Set<string>()
    const actions: { member: GroupMember; category: string }[] = []

    // Keyboard actions.
    const bindings = get<KeyMapLike>('@diamondcoreprocessor.com/KeyMapService')?.getEffective?.() ?? []
    for (const b of bindings) {
      if (!b?.cmd || !b.description) continue
      if (EXCLUDED_COMMANDS.has(b.cmd) || seen.has(b.cmd)) continue
      seen.add(b.cmd)
      actions.push({
        member: { key: b.cmd, label: ACTION_LABELS[b.cmd] ?? b.description, segments: [] },
        category: b.category ?? '',
      })
    }

    // Slash behaviours — one tile per typed command, labelled as typed
    // ("／tags"). Hidden (destructive / dev-only) behaviours stay hidden here
    // exactly as they do in autocomplete.
    const slash = get<SlashDroneLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []
    for (const s of slash) {
      if (!s?.name || s.hidden || EXCLUDED_SLASH.has(s.name)) continue
      const key = `slash:${s.name}`
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        member: { key, label: SLASH_PREFIX + s.name, segments: [] },
        category: 'Slash',
      })
    }

    // Command-line input behaviors — one tile per behavior; its card lists
    // every operation with triggers and worked examples.
    const cli = get<CliMetaLike>('@hypercomb.social/CommandLineBehaviors') ?? []
    for (const c of cli) {
      if (!c?.name) continue
      const key = `cli:${c.name}`
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        member: { key, label: CLI_LABELS[c.name] ?? c.name, segments: [] },
        category: 'Command Line',
      })
    }

    const rank = (c: string): number => {
      const i = CATEGORY_ORDER.indexOf(c)
      return i === -1 ? CATEGORY_ORDER.length : i
    }
    // Bucket into category islands (source order preserved within each), then
    // emit them in CATEGORY_ORDER, each led by a header tile that titles the
    // island. Reference leads the page on its own (no header). The
    // members()-ORDER reconcile (orderedLayout) keeps this interleaving intact,
    // and show-cell reads each header's role to lay the categories out as
    // separated hex blobs.
    const byCategory = new Map<string, GroupMember[]>()
    for (const { member, category } of actions) {
      const cat = category || 'Other'
      const bucket = byCategory.get(cat)
      if (bucket) bucket.push(member)
      else byCategory.set(cat, [member])
    }
    const cats = [...byCategory.keys()].sort((a, b) => rank(a) - rank(b))
    const baseLabel = (cat: string): string => HEADER_LABELS[cat] ?? (cat === 'Other' ? 'More' : cat)
    // First letter of a label, skipping the slash prefix / punctuation.
    const initial = (label: string): string => {
      const m = label.match(/[a-z0-9]/i)
      return (m ? m[0] : label.charAt(0)).toUpperCase()
    }
    // Each island gets a group id ('g0', 'g1', …) shared by its header and its
    // tiles, so show-cell gathers the island by IDENTITY — not by render order,
    // which a slot system re-sorts. The trailing number orders the islands.
    // Reference leads as its own headerless island.
    let gid = 0
    const nextGroup = (): string => `g${gid++}`
    const out: GroupMember[] = [{ ...SHEET_MEMBER, group: nextGroup() }]
    for (const cat of cats) {
      const members = byCategory.get(cat)!
      if (members.length <= MAX_ISLAND) {
        const g = nextGroup()
        out.push({ key: `header:${cat}`, label: baseLabel(cat), segments: [], role: 'header', group: g })
        out.push(...members.map(m => ({ ...m, group: g })))
        continue
      }
      // Big category (Slash) → balanced alphabetical sub-islands, each its own
      // group, titled by its letter range ("Slash A–D"), so it stops dominating.
      const sorted = [...members].sort((a, b) => a.label.localeCompare(b.label))
      const chunks = Math.ceil(sorted.length / MAX_ISLAND)
      const size = Math.ceil(sorted.length / chunks)
      for (let ci = 0; ci < chunks; ci++) {
        const slice = sorted.slice(ci * size, (ci + 1) * size)
        if (slice.length === 0) continue
        const from = initial(slice[0].label)
        const to = initial(slice[slice.length - 1].label)
        const label = from === to ? `${baseLabel(cat)} ${from}` : `${baseLabel(cat)} ${from}–${to}`
        const g = nextGroup()
        out.push({ key: `header:${cat}:${ci}`, label, segments: [], role: 'header', group: g })
        out.push(...slice.map(m => ({ ...m, group: g })))
      }
    }
    return out
  }

  /** Help tiles are documentation: a CLICK pins the action's study card (the
   *  contact-card gesture), it does not execute. ActionCardDrone answers the
   *  request with a pinned card; the card's Run button is what executes. The
   *  Reference tile is the one exception — its operation IS the popup, so it
   *  toggles the sheet directly. */
  protected override activate(m: GroupMember): void {
    // Header tiles title an island; they open nothing.
    if (m.role === 'header') return
    if (m.key === 'ui.shortcutSheet') {
      EffectBus.emit('keymap:invoke', { cmd: m.key, binding: null, event: null })
      return
    }
    EffectBus.emit('action:request-pin', { cmd: m.key, label: m.label })
  }
}

groupRegistry.register(new HelpGroup())
