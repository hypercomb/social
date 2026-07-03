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
const CATEGORY_ORDER = ['Navigation', 'Clipboard', 'Selection', 'Editing', 'History', 'View', 'Mesh', 'Slash', 'Command Line']

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
    actions.sort((a, b) => rank(a.category) - rank(b.category))   // stable — source order within a category
    return [SHEET_MEMBER, ...actions.map(a => a.member)]
  }

  /** Help tiles are documentation: a CLICK pins the action's study card (the
   *  contact-card gesture), it does not execute. ActionCardDrone answers the
   *  request with a pinned card; the card's Run button is what executes. The
   *  Reference tile is the one exception — its operation IS the popup, so it
   *  toggles the sheet directly. */
  protected override activate(m: GroupMember): void {
    if (m.key === 'ui.shortcutSheet') {
      EffectBus.emit('keymap:invoke', { cmd: m.key, binding: null, event: null })
      return
    }
    EffectBus.emit('action:request-pin', { cmd: m.key, label: m.label })
  }
}

groupRegistry.register(new HelpGroup())
