// commands/template-catalog.ts
//
// THE LAYOUTS ON OFFER, AND THE ONE DOOR THAT STARTS A DESIGN. The /template
// word and the template author both read these, and a bee is never imported
// for a value (atomic-modules-plan.md), so they live here, in a dependency
// both import.

import {
  BUILTIN_LAYOUTS,
  builtinLayout,
  nodeOf,
  sanitizeVars,
  templateSlug,
  type LayoutTemplate,
} from '../presentation/tiles/layout-template.js'
import { commitArrangement } from '../presentation/tiles/template-target.js'

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
