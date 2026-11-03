// quickmenu/quick-menu-registry.service.ts
//
// QuickMenuRegistry — which seven hexagons appear, and where they lead.
//
// ── The menu is a vocabulary, not a feature ───────────────────────────
//
// Same reason VisualBeeRegistry and WorkflowStepRegistry exist: the ring is
// one drone, and every menu it can draw is data. A module that wants its own
// quick menu registers a definition; it never touches the gesture, the
// renderer, or this file. Contexts are ViewMode surfaces, so the menu that
// appears follows the surface you are standing on — the workflow designer
// gets workflow verbs, the hexagons get hive verbs, and nothing branches on
// a feature name anywhere in the input path.
//
// ── Why the seeds live in code ────────────────────────────────────────
//
// This is a GESTURE. It must answer in the first frame after the bloom
// delay, on the very first summon of a cold session, with no OPFS read and
// no network on the path — so the shipped menus are declared here and are
// resolved from memory, always.
//
// Hive-authored menus are still the goal and are additive: `adopt()` takes a
// definition assembled from a collection's tiles + direction pheromones and
// REPLACES a cached entry by name. That resolution happens off the gesture
// path, in the background, and the previously cached definition keeps
// answering until the replacement is complete. A menu is never half-built.
//
// IoC key: @diamondcoreprocessor.com/QuickMenuRegistry

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { QuickMenuDefinition, QuickMenuSlot } from './quick-menu.types.js'

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Menu shown when no other definition claims the active surface. */
export const ROOT_MENU = 'root'

/** Wildcard context — the fallback claim. */
const ANY_CONTEXT = '*'

type ViewModeLike = { mode?: string }

// ── seeded definitions ────────────────────────────────────────────────
//
// Every action below names a slash behaviour that ships with the hive, so
// the seeded menus work on a cold install with nothing adopted.

const cmd = (direction: QuickMenuSlot['direction'], label: string, command: string, labelKey?: string): QuickMenuSlot =>
  ({ direction, label, ...(labelKey ? { labelKey } : {}), action: { kind: 'command', command } })

const key = (direction: QuickMenuSlot['direction'], label: string, command: string, labelKey: string): QuickMenuSlot =>
  ({ direction, label, labelKey, action: { kind: 'effect', effect: 'keymap:invoke', payload: { cmd: command } } })

// A verb that acts on tiles. It is handed the tiles the menu was raised over
// when it fires (quick-menu.operands.ts), so it never reads a selection the
// participant is not looking at.
const onTile = (slot: QuickMenuSlot): QuickMenuSlot => ({ ...slot, onTile: true })

const group = (direction: QuickMenuSlot['direction'], label: string, menu: string): QuickMenuSlot =>
  ({ direction, label, action: { kind: 'menu', menu } })

const ROOT: QuickMenuDefinition = {
  name: ROOT_MENU,
  title: 'Hive',
  titleKey: 'quickmenu.root',
  contexts: [ANY_CONTEXT, 'hexagons'],
  slots: [
    // Release without moving: the command line, which is both "make" and
    // "find" here — typing a name creates it or goes to it.
    { direction: 'centre', label: 'command', labelKey: 'quickmenu.command', icon: 'terminal', action: { kind: 'effect', effect: 'command:focus', payload: { cell: '' } } },
    { direction: 'east', label: 'collections', labelKey: 'quickmenu.collections', icon: 'folder_open', action: { kind: 'command', command: 'collections' } },
    { direction: 'southeast', label: 'tags', labelKey: 'quickmenu.tags', icon: 'sell', action: { kind: 'command', command: 'tags' } },
    { direction: 'southwest', label: 'history', labelKey: 'quickmenu.history', icon: 'history', action: { kind: 'command', command: 'history' } },
    { direction: 'west', label: 'tree', labelKey: 'quickmenu.tree', icon: 'account_tree', action: { kind: 'command', command: 'tree' } },
    { direction: 'northwest', label: 'help', labelKey: 'quickmenu.help', icon: 'help', action: { kind: 'command', command: 'help' } },
    // The one nested ring in the shipped set — proves the descend gesture
    // and keeps the surface verbs off the root.
    { direction: 'northeast', label: 'view', labelKey: 'quickmenu.view', icon: 'layers', action: { kind: 'menu', menu: 'root:view' } },
  ],
}

const ROOT_VIEW: QuickMenuDefinition = {
  name: 'root:view',
  title: 'View',
  titleKey: 'quickmenu.view',
  contexts: [],
  slots: [
    { direction: 'centre', label: 'fit', labelKey: 'quickmenu.fit', icon: 'center_focus_strong', action: { kind: 'command', command: 'fit' } },
    { direction: 'east', label: 'present', labelKey: 'quickmenu.present', icon: 'slideshow', action: { kind: 'command', command: 'present' } },
    { direction: 'southeast', label: 'theme', labelKey: 'quickmenu.theme', icon: 'palette', action: { kind: 'command', command: 'theme' } },
    { direction: 'southwest', label: 'layout', labelKey: 'quickmenu.layout', icon: 'dashboard', action: { kind: 'command', command: 'layout' } },
    { direction: 'northwest', label: 'website', labelKey: 'quickmenu.website', icon: 'web', action: { kind: 'command', command: 'website' } },
    { direction: 'northeast', label: 'tutor', labelKey: 'quickmenu.tutor', icon: 'school', action: { kind: 'command', command: 'tutor' } },
  ],
}

const WORKFLOW: QuickMenuDefinition = {
  name: 'workflow',
  title: 'Workflow',
  titleKey: 'quickmenu.workflow',
  contexts: ['workflow'],
  slots: [
    // In the designer the thing you do over and over is run what you just
    // changed, so it takes the zero-travel slot.
    { direction: 'centre', label: 'run', labelKey: 'quickmenu.run', icon: 'play_arrow', action: { kind: 'command', command: 'workflow', args: 'run' } },
    { direction: 'east', label: 'step', labelKey: 'quickmenu.step', icon: 'skip_next', action: { kind: 'command', command: 'workflow', args: 'step' } },
    { direction: 'southeast', label: 'stop', labelKey: 'quickmenu.stop', icon: 'stop', action: { kind: 'effect', effect: 'workflow:run-stop', payload: {} } },
    { direction: 'southwest', label: 'list', labelKey: 'quickmenu.list', icon: 'view_list', action: { kind: 'command', command: 'workflow', args: 'list' } },
    { direction: 'west', label: 'tree', labelKey: 'quickmenu.tree', icon: 'account_tree', action: { kind: 'command', command: 'tree' } },
    { direction: 'northwest', label: 'help', labelKey: 'quickmenu.help', icon: 'help', action: { kind: 'command', command: 'help' } },
    { direction: 'northeast', label: 'new', labelKey: 'quickmenu.new', icon: 'add', action: { kind: 'effect', effect: 'workflow:view-open', payload: {} } },
  ],
}

// The two surfaces below hide the chrome ON PURPOSE — that is what makes them
// worth a ring. There is no toolbar to reach for, so a directional menu is not
// a shortcut for the buttons; it is the only fast way to act at all. The
// centre slot on both is EXIT, because in a view with no chrome the verb you
// want most often is the way out, and the centre is the one slot that costs no
// travel.

const WEBSITE: QuickMenuDefinition = {
  name: 'website',
  title: 'Website',
  titleKey: 'quickmenu.website',
  contexts: ['website'],
  slots: [
    { direction: 'centre', label: 'exit', labelKey: 'quickmenu.exit', icon: 'hexagon', action: { kind: 'command', command: 'view', args: 'hexagons' } },
    { direction: 'east', label: 'save', labelKey: 'quickmenu.save', icon: 'save', action: { kind: 'command', command: 'website', args: 'save' } },
    { direction: 'southeast', label: 'build', labelKey: 'quickmenu.build', icon: 'build', action: { kind: 'command', command: 'website', args: 'build' } },
    { direction: 'southwest', label: 'list', labelKey: 'quickmenu.list', icon: 'view_list', action: { kind: 'command', command: 'website', args: 'list' } },
    { direction: 'west', label: 'tree', labelKey: 'quickmenu.tree', icon: 'account_tree', action: { kind: 'command', command: 'tree' } },
    { direction: 'northwest', label: 'help', labelKey: 'quickmenu.help', icon: 'help', action: { kind: 'command', command: 'help' } },
    { direction: 'northeast', label: 'new', labelKey: 'quickmenu.new', icon: 'add', action: { kind: 'command', command: 'website', args: 'new' } },
  ],
}

// The deck is the clearest argument for point-top there is: east steps
// forward, west steps back, and the two easiest flicks a hand makes are the
// two verbs a presentation is made of. The deck's own verbs live only as
// keyboard handlers, so these slots press keys — see QuickMenuKeyAction.
const SLIDES: QuickMenuDefinition = {
  name: 'slides',
  title: 'Slides',
  titleKey: 'quickmenu.slides',
  contexts: ['slides', 'lightbox'],
  slots: [
    { direction: 'centre', label: 'exit', labelKey: 'quickmenu.exit', icon: 'hexagon', action: { kind: 'command', command: 'view', args: 'hexagons' } },
    { direction: 'east', label: 'next', labelKey: 'quickmenu.next', icon: 'chevron_right', action: { kind: 'key', key: 'ArrowRight' } },
    { direction: 'west', label: 'previous', labelKey: 'quickmenu.previous', icon: 'chevron_left', action: { kind: 'key', key: 'ArrowLeft' } },
    { direction: 'northeast', label: 'first', labelKey: 'quickmenu.first', icon: 'skip_previous', action: { kind: 'key', key: 'Home' } },
    { direction: 'southeast', label: 'last', labelKey: 'quickmenu.last', icon: 'skip_next', action: { kind: 'key', key: 'End' } },
    { direction: 'southwest', label: 'theme', labelKey: 'quickmenu.theme', icon: 'palette', action: { kind: 'command', command: 'theme' } },
    { direction: 'northwest', label: 'help', labelKey: 'quickmenu.help', icon: 'help', action: { kind: 'command', command: 'help' } },
  ],
}

// A picked set of tiles is a SURFACE too — it just isn't a ViewMode, so it
// claims no context and is opened by name (by SelectModeDrone's pill, by
// `/select options`, or by `/menu selection`). Every slot here acts on the
// set rather than on the tile under the pointer, which is the whole reason
// picking exists on a device with no ctrl key: the verbs a finger could not
// reach are all one flick away once the set is built.
//
// Centre is DONE, following the chrome-less rings above: in a mode the only
// verb you are guaranteed to want is the way out, and the centre is the one
// slot that costs no travel.
const SELECTION: QuickMenuDefinition = {
  name: 'selection',
  title: 'Selection',
  titleKey: 'quickmenu.selection',
  contexts: [],
  slots: [
    { direction: 'centre', label: 'done', labelKey: 'quickmenu.done', icon: 'check', action: { kind: 'effect', effect: 'select:done', payload: {} } },
    // The alt menu belongs to the tile under the pointer, so NORTHEAST is
    // select — the one verb every tile has — and the other five are GROUPS of
    // the common behaviours. A group's way back is the direction opposite the
    // one that led in, so each group holds five verbs.
    { direction: 'northeast', label: 'select', icon: 'check_circle', action: { kind: 'effect', effect: 'select:toggle', payload: {} } },
    { ...group('east', 'edit', 'selection:edit'), icon: 'edit' },
    { ...group('southeast', 'organize', 'selection:organize'), icon: 'category' },
    { ...group('southwest', 'view', 'selection:view'), icon: 'layers' },
    { ...group('west', 'go', 'selection:go'), icon: 'explore' },
    { ...group('northwest', 'share', 'selection:share'), icon: 'share' },
  ],
}

const SELECTION_EDIT: QuickMenuDefinition = {
  name: 'selection:edit',
  title: 'Edit',
  contexts: [],
  slots: [
    // The selection onto the shelf: a reference, never a cut (codex A9).
    onTile({ direction: 'east', label: 'shelf', labelKey: 'quickmenu.shelf', icon: 'bookmark', action: { kind: 'effect', effect: 'shelf:take-selection', payload: {} } }),
    onTile({ ...cmd('northwest', 'remove', 'remove', 'quickmenu.remove'), icon: 'delete' }),
    onTile({ ...cmd('northeast', 'hide', 'hide'), icon: 'visibility_off' }),
  ],
}

const SELECTION_ORGANIZE: QuickMenuDefinition = {
  name: 'selection:organize',
  title: 'Organize',
  contexts: [],
  slots: [
    onTile({ ...cmd('east', 'tags', 'tags', 'quickmenu.tags'), icon: 'sell' }),
    { ...cmd('southeast', 'arrange', 'arrange'), icon: 'view_module' },
    onTile({ ...cmd('southwest', 'groups', 'groups'), icon: 'hub' }),
    { direction: 'west', label: 'all', labelKey: 'quickmenu.all', icon: 'select_all', action: { kind: 'effect', effect: 'select:all', payload: {} } },
    { direction: 'northeast', label: 'done', labelKey: 'quickmenu.done', icon: 'check', action: { kind: 'effect', effect: 'select:done', payload: {} } },
  ],
}

const SELECTION_VIEW: QuickMenuDefinition = {
  name: 'selection:view',
  title: 'View',
  contexts: [],
  slots: [
    { ...cmd('east', 'fit', 'fit', 'quickmenu.fit'), icon: 'center_focus_strong' },
    { ...cmd('southeast', 'theme', 'theme', 'quickmenu.theme'), icon: 'palette' },
    { ...cmd('southwest', 'layout', 'layout', 'quickmenu.layout'), icon: 'dashboard' },
    { ...cmd('west', 'present', 'present', 'quickmenu.present'), icon: 'slideshow' },
    { ...cmd('northwest', 'website', 'website', 'quickmenu.website'), icon: 'web' },
  ],
}

const SELECTION_GO: QuickMenuDefinition = {
  name: 'selection:go',
  title: 'Go',
  contexts: [],
  slots: [
    { ...cmd('southeast', 'history', 'history', 'quickmenu.history'), icon: 'history' },
    { ...cmd('southwest', 'collections', 'collections', 'quickmenu.collections'), icon: 'folder_open' },
    { ...cmd('west', 'tree', 'tree', 'quickmenu.tree'), icon: 'account_tree' },
    { ...cmd('northwest', 'help', 'help', 'quickmenu.help'), icon: 'help' },
    { ...cmd('northeast', 'find', 'find'), icon: 'search' },
  ],
}

const SELECTION_SHARE: QuickMenuDefinition = {
  name: 'selection:share',
  title: 'Share',
  contexts: [],
  slots: [
    { ...cmd('east', 'publish', 'publish'), icon: 'cloud_upload' },
    { ...cmd('southwest', 'keys', 'keys'), icon: 'key' },
    onTile({ ...cmd('west', 'invite', 'invite'), icon: 'person_add' }),
    { ...cmd('northwest', 'follow', 'follow'), icon: 'notifications' },
    { ...cmd('northeast', 'republish', 'republish'), icon: 'sync' },
  ],
}

export class QuickMenuRegistry extends EventTarget {
  #definitions = new Map<string, QuickMenuDefinition>()

  constructor() {
    super()
    for (const definition of [ROOT, ROOT_VIEW, WORKFLOW, WEBSITE, SLIDES, SELECTION, SELECTION_EDIT, SELECTION_ORGANIZE, SELECTION_VIEW, SELECTION_GO, SELECTION_SHARE]) {
      this.#definitions.set(definition.name, definition)
    }
  }

  /** Add or replace a definition. Replacement is atomic — the map entry is
   *  swapped whole, so a summon mid-swap sees either the old menu or the new
   *  one, never a mixture. */
  register = (definition: QuickMenuDefinition): void => {
    this.#definitions.set(definition.name, definition)
    this.dispatchEvent(new CustomEvent('change', { detail: { name: definition.name } }))
  }

  /** Replace a menu with a hive-authored version. Identical to register();
   *  named separately because the caller's intent is different and the
   *  distinction matters when reading the boot log. */
  adopt = (definition: QuickMenuDefinition): void => this.register(definition)

  byName = (name: string): QuickMenuDefinition | undefined => this.#definitions.get(name)

  all = (): readonly QuickMenuDefinition[] => [...this.#definitions.values()]

  names = (): readonly string[] => [...this.#definitions.keys()]

  /** The surface the participant is standing on right now. */
  activeContext = (): string => {
    const mode = get<ViewModeLike>('@hypercomb.social/ViewMode')?.mode
    return typeof mode === 'string' && mode ? mode : 'hexagons'
  }

  /** The menu for a surface: the definition that claims it by name, else the
   *  one that claims `*`, else the root. Never returns undefined — a gesture
   *  that summons into an unrecognised surface still gets a usable ring
   *  rather than an empty one. */
  forContext = (context = this.activeContext()): QuickMenuDefinition => {
    for (const definition of this.#definitions.values()) {
      if (definition.contexts.includes(context) && context !== ANY_CONTEXT) return definition
    }
    for (const definition of this.#definitions.values()) {
      if (definition.contexts.includes(ANY_CONTEXT)) return definition
    }
    return this.#definitions.get(ROOT_MENU) ?? ROOT
  }

  /** Localised label for a slot, falling back to the declared English. */
  label = (slot: { label: string; labelKey?: string }): string => {
    if (!slot.labelKey) return slot.label
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    const translated = i18n?.t?.(slot.labelKey)
    return translated && translated !== slot.labelKey ? translated : slot.label
  }
}

// quickmenu/quickmenu.queen.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
