// diamondcoreprocessor.com/groups/help-group.ts (moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1)
//
// The "help" launch group — a PROGRESSIVE TUTORIAL laid out as tiles.
//
// The page is a curated course, not a mirror of the command surface. The
// first island teaches the absolute basics (click in, right-click out, zoom,
// pan, arrows, select); clicking the trailing "Show More" tile reveals the
// next tier — the everyday editing verbs, then the broader skills. Anything
// not curated here (mesh internals, dev commands, input grammars) never gets
// a tutorial tile: the full surface stays one click away behind the leading
// "Reference" tile, which opens the classic shortcut-sheet overlay.
//
// Help tiles are DOCUMENTATION, so they follow the contact-card interaction
// exactly: HOVER a tile and the action's study card peeks (what it does, its
// shortcut or gesture, and the behavior's detail — fed by ActionCardDrone
// over EffectBus); CLICK the tile and the card PINS like a contact card —
// drag several apart to compare and study.
//
// The reached tier is a participant preference, not content: it lives in
// localStorage (like the locale), never in a layer. Every reconcile reads it
// fresh, so "Show More" only has to bump the number and notify.
//
// Members resolve against the LIVE registries at call time (KeyMapService,
// SlashBehaviourDrone, CommandLineBehaviors — through window.ioc, never
// imported). A curated key whose behavior hasn't registered yet simply
// doesn't get a tile; whenReady re-renders once the keymap arrives.

import { EffectBus, groupSignature, type KeyBinding } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry.js'
import { LaunchGroupBase } from './launch-group-base.js'

/** The classic /help reference sheet, as one tile ahead of the course. Tapping
 *  it toggles the overlay via the same keymap command `/` and /help use —
 *  ShortcutSheetDrone stays the one owner of open/close state. */
const SHEET_MEMBER: GroupMember = { key: 'ui.shortcutSheet', label: 'Reference', segments: [], icon: 'menu_book' }

/** The tier-advance affordance — the participant ASKING to see more. Clicking
 *  it bumps the stored tier and reconciles the next island in. It disappears
 *  once the last tier is reached. */
const MORE_MEMBER: GroupMember = { key: 'help:more', label: 'Show More', segments: [], icon: 'unfold_more' }

/** Where the reached tier lives — a preference, like the locale. */
const TIER_KEY = 'hypercomb.help.tier'

/** The mouse/trackpad basics — not keymap bindings, so they are declared
 *  here. ActionCardDrone owns each card's content (keyed `gesture:<id>`). */
const GESTURES: readonly { id: string; label: string }[] = [
  { id: 'open', label: 'Go In' },
  { id: 'back', label: 'Go Out' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'pan', label: 'Pan' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'select', label: 'Select' },
]

/** Curated tile names — binding descriptions are sentences ("Arrange tiles
 *  by the next sequence"); a tile wants a word. Only curated commands appear,
 *  so this map IS the keymap roster. */
const ACTION_LABELS: Record<string, string> = {
  'tile.editHovered': 'Edit',
  'clipboard.copy': 'Copy',
  'clipboard.paste': 'Paste',
  'layout.cutCells': 'Cut',
  'selection.remove': 'Remove',
  'history.undo': 'Undo',
  'history.redo': 'Redo',
  'navigation.fitToScreen': 'Fit',
  'navigation.recenter': 'Center',
  'ui.commandPalette': 'Palette',
  'ui.commandLineToggle': 'Command Line',
  'chat.toggle': 'Assistant',
  'sequence.cycle': 'Arrange',
  'sequence.cyclePrev': 'Arrange Back',
  'render.toggleOrientation': 'Orientation',
  'mesh.togglePublic': 'Public Mode',
}

/** Curated names for the command-line input behaviors on the course. */
const CLI_LABELS: Record<string, string> = {
  'create': 'Create Tiles',
}

/** Slash tiles read as their typed form. A REAL '/' can't lead a cell name
 *  (labels travel through path-shaped code), so the fullwidth solidus U+FF0F
 *  stands in — renders as the slash the participant actually types. */
const SLASH_PREFIX = '／'

/** The GUIDED TOURS island — the courses the beeing flies for you, ahead of
 *  the reading material. Levels come from the tutorial's own lesson registry
 *  (a build without the tutorial module simply has no island), and a click
 *  RUNS the course: a tutorial tile's operation IS starting the tour, the same
 *  exception the Reference tile gets. */
const TOUR_LABELS: Record<string, string> = {
  starter: 'Take the Tour',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  expert: 'Expert',
}
const TOUR_ORDER: readonly string[] = ['starter', 'beginner', 'intermediate', 'expert']

type LessonRegistryLike = { levels?: () => string[] }

const tourLevels = (): string[] => {
  const registry = get<LessonRegistryLike>('@diamondcoreprocessor.com/TutorialLessonRegistry')
  const levels = registry?.levels?.()
  if (!levels?.length) return []
  return TOUR_ORDER.filter(l => levels.includes(l))
}

/** GROUP SIGNATURES for the islands — `sign('group:<meaning>')`, derived once
 *  at module load. Every tile of an island carries its island's signature into
 *  its `launch:target` decoration, so the island is a real GROUP: addressable,
 *  countable, and removable as one unit rather than as "whatever tiles happen
 *  to sit near each other". Sync map because members() is sync; the launcher
 *  re-renders when the derivations land. */
const groupSigs = new Map<string, string>()
const deriveGroupSigs = (meanings: readonly string[]): void => {
  void Promise.all(meanings.map(async meaning => {
    if (groupSigs.has(meaning)) return
    groupSigs.set(meaning, await groupSignature(meaning))
  })).then(() => groupRegistry.notifyChanged())
}

/** The course. One island per tier, revealed in order; tier 0 always shows.
 *  Keys resolve by shape: `gesture:<id>` (static basics), `slash:<name>`,
 *  `cli:<name>`, anything else a keymap cmd. A key whose behavior isn't
 *  registered is skipped, never a broken tile. */
const TIERS: readonly { header: string; keys: readonly string[] }[] = [
  {
    header: 'Basics',
    keys: GESTURES.map(g => `gesture:${g.id}`),
  },
  {
    header: 'Everyday',
    keys: [
      'cli:create',
      'tile.editHovered',
      'clipboard.copy',
      'clipboard.paste',
      'layout.cutCells',
      'selection.remove',
      'history.undo',
      'history.redo',
      'navigation.fitToScreen',
      'navigation.recenter',
    ],
  },
  {
    header: 'Beyond',
    keys: [
      'ui.commandPalette',
      'ui.commandLineToggle',
      'chat.toggle',
      'sequence.cycle',
      'sequence.cyclePrev',
      'render.toggleOrientation',
      'mesh.togglePublic',
      'slash:language',
      'slash:accent',
    ],
  },
]

const readTier = (): number => {
  try {
    const n = Number(window.localStorage?.getItem(TIER_KEY) ?? '0')
    return Number.isFinite(n) ? Math.max(0, Math.min(TIERS.length - 1, Math.floor(n))) : 0
  } catch {
    return 0
  }
}

const writeTier = (n: number): void => {
  try { window.localStorage?.setItem(TIER_KEY, String(Math.max(0, Math.min(TIERS.length - 1, n)))) } catch { /* storage unavailable */ }
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
   *  tier, titled by a header tile — not one continuous spiral. This also
   *  makes the reconcile keep the page in members() order so each header
   *  interleaves directly ahead of its tier's tiles. */
  readonly orderedLayout = true

  constructor() {
    super()
    // Actions live in the keymap (an essentials service) and may register
    // after this shell module — re-render the launcher when they arrive.
    // Anything already up is covered by members() enumerating at call time.
    const ioc = (window as unknown as { ioc?: IocLike }).ioc
    ioc?.whenReady?.('@diamondcoreprocessor.com/KeyMapService', () => groupRegistry.notifyChanged())
    // Same for the tutorial's lesson roster — the Guided Tours island exists
    // only once some module has registered lessons.
    ioc?.whenReady?.('@diamondcoreprocessor.com/TutorialLessonRegistry', () => groupRegistry.notifyChanged())
  }

  /** The Reference tile + one island per REACHED tier + the Show More tile
   *  while there is more to show. Non-gesture members resolve against the
   *  live registries, so a rebound key renders its new combo and a missing
   *  behavior is skipped — the course never drifts from the code. */
  override members(): GroupMember[] {
    const bindings = get<KeyMapLike>('@diamondcoreprocessor.com/KeyMapService')?.getEffective?.() ?? []
    const byCmd = new Map<string, KeyBinding>()
    for (const b of bindings) if (b?.cmd && !byCmd.has(b.cmd)) byCmd.set(b.cmd, b)
    const slash = new Set(
      (get<SlashDroneLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? [])
        .filter(s => s?.name && !s.hidden)
        .map(s => s.name),
    )
    const cli = new Set((get<CliMetaLike>('@hypercomb.social/CommandLineBehaviors') ?? []).map(c => c?.name).filter(Boolean))

    const resolve = (key: string): GroupMember | null => {
      if (key.startsWith('gesture:')) {
        const g = GESTURES.find(x => key === `gesture:${x.id}`)
        return g ? { key, label: g.label, segments: [] } : null
      }
      if (key.startsWith('slash:')) {
        const name = key.slice(6)
        return slash.has(name) ? { key, label: SLASH_PREFIX + name, segments: [] } : null
      }
      if (key.startsWith('cli:')) {
        const name = key.slice(4)
        return cli.has(name) ? { key, label: CLI_LABELS[name] ?? name, segments: [] } : null
      }
      const b = byCmd.get(key)
      return b ? { key, label: ACTION_LABELS[key] ?? b.description ?? key, segments: [] } : null
    }

    // Each island gets a group id ('g0', 'g1', …) shared by its header and its
    // tiles, so show-cell gathers the island by IDENTITY — not by render order,
    // which a slot system re-sorts. The trailing number orders the islands.
    // Reference leads as its own headerless island; Show More trails as one.
    const reached = readTier()
    const levels = tourLevels()

    // Every island is a GROUP, named by a meaning and identified by its
    // signature. Derive the whole set once per projection (a hit after the
    // first call) so the members can carry their signatures.
    deriveGroupSigs([
      'help:island:reference',
      ...(levels.length ? ['help:island:tours'] : []),
      ...TIERS.map(t => `help:tier:${t.header.toLowerCase()}`),
      'help:island:more',
    ])

    let gid = 0
    /** One island: its layout ordinal and its group signature. */
    const island = (meaning: string): { group: string; groupSig?: string } => ({
      group: `g${gid++}`,
      groupSig: groupSigs.get(meaning),
    })

    const out: GroupMember[] = [{ ...SHEET_MEMBER, ...island('help:island:reference') }]

    // The tours lead the course — everything here can be READ, but the bee can
    // also fly it for you.
    if (levels.length > 0) {
      const g = island('help:island:tours')
      out.push({ key: 'header:Guided Tours', label: 'Guided Tours', segments: [], role: 'header', ...g })
      out.push(...levels.map(level => ({
        key: `tutorial:${level}`,
        label: TOUR_LABELS[level] ?? level,
        segments: [],
        icon: 'flight_takeoff',
        ...g,
      })))
    }

    for (let t = 0; t <= reached && t < TIERS.length; t++) {
      const tier = TIERS[t]
      const members = tier.keys
        .map(resolve)
        .filter((m): m is GroupMember => m !== null)
      if (members.length === 0) continue
      const g = island(`help:tier:${tier.header.toLowerCase()}`)
      out.push({ key: `header:${tier.header}`, label: tier.header, segments: [], role: 'header', ...g })
      out.push(...members.map(m => ({ ...m, ...g })))
    }
    if (reached < TIERS.length - 1) out.push({ ...MORE_MEMBER, ...island('help:island:more') })
    return out
  }

  /** Help tiles are documentation: a CLICK pins the action's study card (the
   *  contact-card gesture), it does not execute. Two exceptions route for
   *  real: the Reference tile toggles the sheet (its operation IS the popup)
   *  and Show More advances the tutorial — the participant asking to see the
   *  next increment. */
  protected override activate(m: GroupMember): void {
    // Header tiles title an island; they open nothing.
    if (m.role === 'header') return
    // A tour tile's operation IS the tour — clicking it sends the beeing up.
    if (m.key.startsWith('tutorial:')) {
      EffectBus.emit('tutorial:start', { level: m.key.slice('tutorial:'.length) })
      return
    }
    if (m.key === 'ui.shortcutSheet') {
      EffectBus.emit('keymap:invoke', { cmd: m.key, binding: null, event: null })
      return
    }
    if (m.key === MORE_MEMBER.key) {
      writeTier(readTier() + 1)
      // refreshIfActive reconciles the new island in place — no navigation,
      // no auto-fit; the page grows and the participant explores to it.
      groupRegistry.notifyChanged()
      return
    }
    EffectBus.emit('action:request-pin', { cmd: m.key, label: m.label })
  }
}

groupRegistry.register(new HelpGroup())
