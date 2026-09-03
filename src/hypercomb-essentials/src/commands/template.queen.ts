// /template — LAYOUT TEMPLATES, and the targets they are plugged into.
//
//   /template                     open or close the layout designer window
//   /template rail                plug THIS container into the `rail` layout
//   /template off                 unplug it
//   /template list                the layouts this hive can reach
//   /template rotate              turn this container a quarter
//   /template set rail 14rem      change one variable, here only
//   /template save my-shell       save the current shape under a name
//
// A layout template is a shared artifact; a target is the mark a container
// wears to read through one. Neither is a parent — see layout-template.ts and
// template-target.ts for why that is the whole point, and
// documentation/layout-templates.md for the design.
//
// The six built-ins — `single`, `split`, `rail`, `thirds`, `bookends`,
// `measure` — are data, so a seventh costs no code. Each is drawn ONE way and
// turned to the other three, and each is named for the arrangement it makes:
// not for the proportions it happens to start with, and not for a SIDE, which
// stops being true the moment somebody turns it.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  BUILTIN_LAYOUTS,
  builtinLayout,
  nodeOf,
  sanitizeVars,
  templateSlug,
  turnedDirection,
  variablesOf,
  withVarAt,
  type LayoutTemplate,
} from '../presentation/tiles/layout-template.js'
import {
  TEMPLATE_TARGET_KIND,
  commitArrangement,
  loadTemplate,
  readTemplateTarget,
  removeTemplateTarget,
  resolveTemplateAt,
} from '../presentation/tiles/template-target.js'
import {
  ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn,
} from '../sharing/behavior-enablement.js'

/** The designer's identity in the behaviour roster. It is a DOCKED TOOL
 *  WINDOW, not a takeover — the control bar and the hive stay on screen beside
 *  it, the way the chat window works — so it is deliberately absent from the
 *  shell's TRANSIENT_MODES and drives no view mode at all. */
export const TEMPLATE_VIEW = 'templates'

/** Ask the designer to show itself, or to put itself away — `{ open, at }`.
 *
 *  AN EXPLICIT INTENT, NEVER A TOGGLE. The bus replays its last value to late
 *  subscribers, so a flip can get out of parity: miss one delivery or take one
 *  twice and every later press means the opposite of what it says. An intent
 *  is idempotent, and two of them in a row are simply the same answer.
 *
 *  The panel still owns its own visibility and reports it back on
 *  `template:view-state`; this only asks. */
export const TEMPLATE_OPEN = 'template:open'

type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/**
 * Plug a location into a named layout — a fresh arrangement of one level.
 *
 * The one door for STARTING a design: the command and the designer both come
 * here, so there is exactly one way a target is first set. Nesting is a
 * different act (it edits an arrangement that already exists) and lives in
 * template-author.drone.ts.
 */
export async function targetTemplate(
  segments: readonly string[],
  name: string,
  vars?: Readonly<Record<string, string>>,
): Promise<LayoutTemplate | null> {
  // NO EMPTY-SEGMENTS GUARD. The hive root is a container — it has children,
  // it has a page, and it is the most likely thing anybody designs first. It
  // was refused here for no better reason than having no name, and the refusal
  // was SILENT: standing at the root, every click and every drop did nothing
  // and said nothing.
  const template = await findTemplate(name)
  if (!template) return null
  const sig = await commitArrangement(segments, nodeOf(template, { ...template.vars, ...sanitizeVars(vars) }))
  return sig ? template : null
}

/** A layout by name: a built-in, or one already bound somewhere this session
 *  reached. Saved templates are found through the target that named them —
 *  there is no registry, because a template that nothing points at is not a
 *  thing this hive has. */
export async function findTemplate(name: string): Promise<LayoutTemplate | null> {
  const slug = templateSlug(name)
  if (!slug) return null
  const built = builtinLayout(slug)
  if (built) return built
  return savedTemplates().get(slug) ?? null
}

/** Templates minted this session, by name. A cheap side-index so `/template
 *  my-shell` finds a layout saved a moment ago without a hive walk. It is a
 *  convenience, never truth: the truth is the signature on the target. */
const saved = new Map<string, LayoutTemplate>()
export const savedTemplates = (): ReadonlyMap<string, LayoutTemplate> => saved
export const rememberTemplate = (template: LayoutTemplate): void => {
  if (!builtinLayout(template.name)) saved.set(template.name, template)
}

/** Every layout offerable right now: the built-ins, then anything saved. */
export const knownTemplates = (): readonly LayoutTemplate[] =>
  [...BUILTIN_LAYOUTS, ...saved.values()]

export class TemplateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  readonly command = 'template'
  override description = 'Layout templates — plug a container into a named, shared layout'
  override descriptionKey = 'slash.template'
  override options = ['<name>', 'off', 'list', 'rotate', 'set <var> <value>', 'save <name>']
  override examples = [
    { input: '/template rail', result: 'Plugs this container into the rail layout' },
    { input: '/template rotate', result: 'Turns this container a quarter — a rail becomes a header' },
    { input: '/template set rail 14rem', result: 'Widens the rail hole, here only' },
    { input: '/template off', result: 'Unplugs this container' },
  ]

  override slashComplete(args: string): readonly string[] {
    const verbs = ['off', 'list', 'rotate', 'set', 'save', ...knownTemplates().map(t => t.name)]
    const query = args.toLowerCase().trim()
    if (!query) return verbs
    return verbs.filter(v => v.startsWith(query))
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = '', ...rest] = trimmed.split(/\s+/)
    const lower = verb.toLowerCase()

    if (!verb) { this.#toggleView(); return }
    if (lower === 'list') { await this.#list(); return }
    if (lower === 'off' || lower === 'remove' || lower === 'none') { await this.#off(); return }
    if (lower === 'rotate' || lower === 'turn') { await this.#rotate(); return }
    if (lower === 'set') { await this.#set(rest[0] ?? '', rest.slice(1).join(' ')); return }
    if (lower === 'save') { await this.#save(rest.join(' ')); return }
    await this.#target(trimmed)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  #toggleView(): void {
    // The INTENT, not a flip. See TEMPLATE_OPEN.
    EffectBus.emit(TEMPLATE_OPEN, { open: !panelOpen, at: Date.now() })
  }

  // ── the navigation-behaviour controller contract ──────────────────
  //
  // ViewBee delegates the command-line toggle here rather than switching a
  // view mode, because this behaviour is a WINDOW. `isActive` answers from
  // what the panel last reported, never from a wish of ours.

  isAvailable(): boolean { return true }
  isActive(): boolean { return panelOpen }
  toggleBehavior(): void { this.#toggleView() }

  async #target(name: string): Promise<void> {
    const segments = this.#segments()
    const template = await targetTemplate(segments, name)
    if (!template) {
      EffectBus.emit('activity:log', { message: `No layout called "${templateSlug(name)}"`, icon: 'dashboard' })
      return
    }
    EffectBus.emit('activity:log', {
      message: `${segments.at(-1)} reads through the ${template.name} layout`,
      icon: 'dashboard',
    })
  }

  async #off(): Promise<void> {
    const segments = this.#segments()
    const removed = await removeTemplateTarget(segments)
    if (removed) {
      EffectBus.emit('activity:log', { message: 'Layout unplugged', icon: 'dashboard' })
    }
  }

  /**
   * Turn this container a quarter.
   *
   * The ROOT level, like `/template set` — the command line has no selection,
   * and the level a design starts from is the one it can honestly mean. Inside
   * the designer a turn is aimed at whichever level is selected.
   *
   * It writes `direction` and nothing else: a turn is a quarter of the main
   * axis, and every hole is already written so that it does not care which
   * axis that is (layout-template.ts).
   */
  async #rotate(): Promise<void> {
    const segments = this.#segments()
    const bound = await resolveTemplateAt(segments)
    if (!bound) {
      EffectBus.emit('activity:log', { message: 'Nothing is plugged in here yet', icon: 'dashboard' })
      return
    }
    const next = turnedDirection(bound.template, bound.vars)
    await commitArrangement(segments, withVarAt(bound.node, [], 'direction', next))
    EffectBus.emit('activity:log', {
      message: `${bound.template.name} turned a quarter — it runs ${next} now`,
      icon: 'dashboard',
    })
  }

  /** Change one variable on THIS container's root level. The change re-mints
   *  that level and the chain above it and nothing else — the arrangement is a
   *  merkle tree, so an edit is a new signature, never a mutation. */
  async #set(name: string, value: string): Promise<void> {
    const segments = this.#segments()
    const bound = await resolveTemplateAt(segments)
    if (!bound) {
      EffectBus.emit('activity:log', { message: 'Nothing is plugged in here yet', icon: 'dashboard' })
      return
    }
    const clean = sanitizeVars({ [name]: value })
    const key = Object.keys(clean)[0]
    if (!key) {
      EffectBus.emit('activity:log', { message: `"${value}" is not a length`, icon: 'dashboard' })
      return
    }
    await commitArrangement(segments, withVarAt(bound.node, [], key, clean[key]))
    EffectBus.emit('activity:log', { message: `${key} → ${clean[key]}`, icon: 'dashboard' })
  }

  /**
   * Save what this container currently reads as a NEW named layout: the bound
   * template's shape with this container's overrides folded in as the new
   * defaults. The container is then re-targeted onto the saved one, so the
   * thing on screen and the thing saved are the same thing.
   */
  async #save(name: string): Promise<void> {
    const slug = templateSlug(name)
    const segments = this.#segments()
    if (!slug) {
      EffectBus.emit('activity:log', { message: 'Give the layout a name', icon: 'dashboard' })
      return
    }
    if (builtinLayout(slug)) {
      EffectBus.emit('activity:log', { message: `"${slug}" is a built-in layout`, icon: 'dashboard' })
      return
    }
    const bound = await resolveTemplateAt(segments)
    if (!bound) {
      EffectBus.emit('activity:log', { message: 'Nothing is plugged in here to save', icon: 'dashboard' })
      return
    }
    const template: LayoutTemplate = {
      ...bound.template, name: slug, vars: bound.vars,
    }
    rememberTemplate(template)
    // Re-target with NO overrides at the root: what was an override is now the
    // default. Anything nested keeps its own arrangement untouched.
    await commitArrangement(segments, nodeOf(template, template.vars, bound.node.nested))
    EffectBus.emit('activity:log', { message: `Saved the ${slug} layout`, icon: 'dashboard' })
  }

  async #list(): Promise<void> {
    const here = await resolveTemplateAt(this.#segments())
    const lines = knownTemplates().map(t => {
      const holes = t.holes.map(h => (h.self ? `(${h.key})` : h.key)).join(' · ')
      const mark = here?.template.name === t.name ? '→ ' : '  '
      return `${mark}${t.name} — ${t.flow}: ${holes}`
    })
    if (here) {
      lines.push('', `variables: ${variablesOf(here.template).map(v => `${v}=${here.vars[v] ?? '—'}`).join('  ')}`)
    }
    EffectBus.emit('activity:log', { message: lines.join('\n'), icon: 'dashboard' })
  }
}

/** What the panel last said about itself. The queen reports it and never
 *  decides it — see TEMPLATE_OPEN. */
let panelOpen = false
EffectBus.on<{ open?: boolean }>('template:view-state', payload => {
  panelOpen = payload?.open === true
})

/** A NEW KIND ARRIVES DARK. `layout:template` is a kind nobody has seen, so a
 *  hive that already has an on-list would treat it as globally off and the
 *  designer would refuse to open on its own content. Lit as a cohort: once,
 *  only after the census seed exists, and refused outright on a hive that
 *  opened dark — see project memory, "new view arrives dark". */
const TEMPLATE_COHORT = 'layout-template'

const lightTemplatesOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(TEMPLATE_COHORT, [TEMPLATE_TARGET_KIND])
}
lightTemplatesOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightTemplatesOnce)

const _template = new TemplateQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TemplateQueenBee', _template)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: TEMPLATE_VIEW,
    slashCommand: '/template',
    iconName: 'dashboard',
    toggleIcon: 'dashboard',
    behavior: 'navigation',
    controllerKey: '@diamondcoreprocessor.com/TemplateQueenBee',
    decorationKind: TEMPLATE_TARGET_KIND,
    labelKey: 'view.templates',
    descriptionKey: 'view.templates.description',
    queenKey: '@diamondcoreprocessor.com/TemplateQueenBee',
    adoptable: true,
    attachable: true,
    pheromones: ['platform:desktop'],
  }),
)

export { loadTemplate, resolveTemplateAt }
