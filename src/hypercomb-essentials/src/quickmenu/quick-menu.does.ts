// quickmenu/quick-menu.does.ts
//
// What the option under the pointer WILL DO, said as a sentence a person can
// read: the behaviour, and the tile it reaches.
//
//   hide, over "notes"            Hide “notes” from view here; nothing is deleted
//   remove, three tiles picked    Remove 3 tiles from this layer
//   fit                           Zoom to fit everything on screen
//
// The word on the hexagon stays the identity; this is the reading of it. The
// sentence is found by what the slot RUNS (the command, the effect, the key),
// not by its label, so a renamed or translated label is still described, and a
// tile's own automaton that swaps in another word is described by that word.
// A tile verb names the tiles it will reach (quick-menu.operands.ts); a surface
// verb does not pretend to be about the tile it was raised over.
//
// A word with no sentence here (a community behaviour, a tile's own seat) is
// still said plainly — `Run copy on “notes”` — never left blank.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { QuickMenuAction, QuickMenuSlot } from './quick-menu.types.js'

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type Params = Readonly<Record<string, string>>

const fill = (template: string, params: Params): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole)

/** The catalog's wording, falling back to the English given. */
export function say(key: string, fallback: string, params: Params = {}): string {
  const translated = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, { ...params })
  return translated && translated !== key ? translated : fill(fallback, params)
}

// Keyed by what the slot runs. `.many` is the wording when the verb reaches
// several tiles; `.picked` when the tile is already in the set. `{tile}` is the
// tiles the verb reaches, `{subject}` the one tile the menu was raised over.
const DOES: Readonly<Record<string, string>> = {
  // the hive
  'command.focus': 'Open the command line: type a name to make a tile or go to one',
  'help': 'Show what you can do here, and the shortcuts',
  'history': 'Open the history panel to step back through changes',
  'tree': 'Draw this layer as a sideways tree',
  'find': 'Find tiles by a word in their name',
  'hosts': 'Open your hosts',
  'collections': 'Open your collections',
  'behavior': 'Give a tile a behaviour of your own',
  'discover': 'See what the hosts you follow are sharing',
  'chat': 'Open the chat with your AI',
  'fit': 'Zoom to fit everything on screen',
  'present': 'Play the presentation as slides',
  'theme': 'Switch the theme: light, dark or system',
  'layout': 'Choose which tiles this layer shows',
  'website': 'Switch between the hexagons and the website view',
  'tutor': 'Turn this hive into study games',
  'view.hexagons': 'Leave this view and go back to the hexagons',

  // tiles
  'remove': 'Remove {tile} from this layer',
  'hide': 'Hide {tile} from view here; nothing is deleted',
  'images': 'Choose a picture for {tile}',
  'images.many': 'Choose a picture for each of {tile}, one tile at a time',
  'comfy.each': 'Generate a picture for {tile} from its name',
  'comfy.each.many': 'Generate a picture for each of {tile}, each from its own name',
  'groups': 'Open publish groups on this layer, with {tile} ready to join one',
  'invite': 'Turn {tile} into a swarm junction and copy an invite link',
  'invite.many': 'Turn {tile} into swarm junctions and copy a link to the first',

  // the shelf and the picked set
  'shelf.take-selection': 'Keep a reference to {tile} on the shelf; nothing is moved',
  'shelf.save': 'Keep what is on the shelf as a new group',
  'shelf.recall': 'Bring the group {word} back onto the shelf',
  'select.toggle': 'Pick {subject} so the verbs reach it too',
  'select.toggle.picked': 'Take {subject} out of the picked tiles',
  'select.all': 'Pick every tile on this layer',
  'select.done': 'Clear the picked tiles and finish picking',

  // sharing
  'publish': 'Show what your hive is serving, and what has changed',
  'keys': 'See who publishes for you',
  'follow': 'Follow a domain to read what it publishes',
  'republish': 'Publish again every page that has changed',
  'arrange': 'Rearrange the icons on the tile overlay',

  // workflows and websites
  'workflow.run': 'Run the workflow',
  'workflow.step': 'Run the next step of the workflow',
  'workflow.run-stop': 'Stop the running workflow',
  'workflow.list': 'List your workflows',
  'workflow.view-open': 'Start a new workflow',
  'website.save': 'Save the page you are looking at',
  'website.build': 'Build the pages of this website',
  'website.list': 'List the pages of this website',
  'website.new': 'Start a new page',

  // the deck
  'key.ArrowRight': 'Go to the next slide',
  'key.ArrowLeft': 'Go back one slide',
  'key.Home': 'Jump to the first slide',
  'key.End': 'Jump to the last slide',
}

/** What a slot runs, as the key its sentence is filed under. A pathway has none:
 *  it only moves the flower, and says nothing of its own. */
export function runsAs(action: QuickMenuAction): string | undefined {
  switch (action.kind) {
    case 'command': return action.args ? `${action.command}.${action.args.trim().split(/\s+/).join('.')}` : action.command
    case 'effect': return action.effect.replace(':', '.')
    case 'key': return `key.${action.key}`
    default: return undefined
  }
}

const quoted = (name: string): string => `“${name}”`

/** The tiles a tile verb will reach, said short: the one tile named, or how many. */
export function tilesWord(subject: string | null, operands: readonly string[], alone = false): string {
  if (!alone && operands.length > 1) return `${operands.length} ${say('quickmenu.guide.tiles', 'tiles')}`
  const only = alone ? subject : operands[0] ?? subject
  return only ? quoted(only) : ''
}

export type DoesInput = {
  readonly slot: QuickMenuSlot
  /** The option as worded on its hexagon. */
  readonly label: string
  readonly subject: string | null
  readonly operands: readonly string[]
  /** The tile the menu was raised over is already in the picked set. */
  readonly picked?: boolean
}

/** The sentence for the lit option, or nothing for a pathway. Pure. */
export function doesFor(input: DoesInput): string {
  const { slot, label, subject, operands } = input
  const id = runsAs(slot.action)
  if (!id) return ''

  const tile = slot.onTile ? tilesWord(subject, operands, slot.alone) : ''
  // What it runs is the word to name when nothing here describes it: a tile's own
  // automaton can swap another word into a seat whose label stays the same.
  const word = slot.action.kind === 'command' ? slot.action.command : label
  const params: Params = {
    tile,
    subject: subject ? quoted(subject) : tile,
    word,
  }

  const many = !!slot.onTile && !slot.alone && operands.length > 1
  const variants = [...(input.picked ? [`${id}.picked`] : []), ...(many ? [`${id}.many`] : []), id]
  for (const variant of variants) {
    const template = DOES[variant]
    if (template) return say(`quickmenu.does.${variant}`, template, params)
  }

  return slot.onTile
    ? say('quickmenu.does.run-on', 'Run {word} on {tile}', params)
    : say('quickmenu.does.run', 'Run {word}', params)
}
