// diamondcoreprocessor.com/workflow/workflow-step-registry.ts
//
// WorkflowStepRegistry — the vocabulary of step KINDS a workflow can be
// built out of, and the palette the designer offers.
//
// ── The vocabulary is mostly not written here ─────────────────────────
//
// The hive already has a complete, self-extending list of things it can be
// told to do: its slash commands. `SlashBehaviourDrone.entries()` is that
// list, and `execute(name, args)` runs one. So the `command` kind covers
// nearly everything, and the palette grows on its own — a module that ships
// a new queen ships a new step, with no registration here and no change to
// this file. That is the whole reason the palette is derived rather than
// declared: a hand-kept step list would be stale the day after it was
// written.
//
// What IS declared here is the small set of kinds that are NOT commands,
// because they are about the workflow rather than about the hive:
//
//   • `command`  — run a slash command (the workhorse; params: command+args)
//   • `ask`      — hand a question to an AI pass. Deliberately does NOT
//                  generate: it deposits an `ai:request` and stops, exactly
//                  as the meaning loop requires (ask before creating,
//                  always). The answer arrives in the feedback window.
//   • `sub`      — run this step tile's OWN children as a workflow. Steps
//                  are tiles, tiles have children, so nesting is free.
//   • `note`     — record a line of prose on the step's tile as the run
//                  passes through it. The cheap way to leave a trail.
//
// A module may add its own kind with `register()` and supply a `run`. It
// never has to: shipping a queen is enough.
//
// ── Why a registry and not a switch ───────────────────────────────────
//
// Same reason VisualBeeRegistry exists: two consumers need the same list.
// The DESIGNER needs it to draw a palette and an inspector; the RUNNER
// needs it to execute. A switch statement in the runner would leave the
// designer guessing at what it can offer.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { WorkflowStep } from './workflow-step.js'

/** What a step's execution reports back. */
export type WorkflowStepStatus =
  /** Ran to completion. */
  | 'done'
  /** Nothing to do — an unconfigured step, or a kind that declined. */
  | 'skipped'
  /** Tried and failed. The run reports it and CARRIES ON to the next step
   *  only when the workflow was started in continue-on-error mode; the
   *  default is to stop, because a workflow whose third step failed has not
   *  done what its name says. */
  | 'failed'
  /** Handed to an AI pass and awaiting the participant's answer. Not a
   *  failure and not a completion — the run ends here by design. */
  | 'asked'

export interface WorkflowStepOutcome {
  readonly status: WorkflowStepStatus
  /** One line for the run log — what happened, or why it didn't. */
  readonly detail?: string
}

/** What a kind's `run` is handed. */
export interface WorkflowRunContext {
  /** The step record being executed. */
  readonly step: WorkflowStep
  /** The step tile's name. */
  readonly cell: string
  /** The step tile's lineage segments. */
  readonly segments: readonly string[]
  /** The workflow cell's lineage segments. */
  readonly workflowSegments: readonly string[]
  /** The workflow's name, when it has one. */
  readonly workflowName: string
  /** Expand `{cell}` / `{scope}` / `{workflow}` in a template string. */
  interpolate(template: string): string
  /** Run a nested workflow rooted at `segments`. Depth-capped by the runner. */
  runNested(segments: readonly string[]): Promise<WorkflowStepOutcome>
}

export interface WorkflowStepKind {
  /** Registry key, stored in the step record's `kind` field. */
  readonly kind: string
  /** Material Symbols ligature for the palette + the inspector. */
  readonly icon: string
  /** Fallback label; `labelKey` wins when the catalog has it. */
  readonly label: string
  readonly labelKey?: string
  /** Fallback one-liner; `descriptionKey` wins. */
  readonly description?: string
  readonly descriptionKey?: string
  /** Palette grouping — 'control' sorts first, then behaviours, then the
   *  long tail of commands. */
  readonly group: 'control' | 'behaviour' | 'command'
  /** Which fields the inspector should offer for this kind. Keeps the
   *  inspector honest without it knowing anything about any one kind. */
  readonly fields?: readonly ('command' | 'args' | 'text' | 'model')[]
  /** Executor. Kinds without one are executed by the runner's built-ins. */
  run?(ctx: WorkflowRunContext): Promise<WorkflowStepOutcome> | WorkflowStepOutcome
}

/** A palette row the designer draws. Either a registered kind, or one of
 *  the live slash commands surfaced as a ready-made `command` step. */
export interface WorkflowPaletteEntry {
  readonly kind: string
  readonly icon: string
  readonly label: string
  readonly description: string
  readonly group: 'control' | 'behaviour' | 'command'
  /** Present on command rows — the slash behaviour the step will run. */
  readonly command?: string
  /** Which fields the inspector should offer. Carried on the entry so the
   *  designer never has to know anything about any particular kind. */
  readonly fields: readonly ('command' | 'args' | 'text' | 'model')[]
  /** The step record this row creates when added to the workflow. */
  readonly seed: WorkflowStep
}

export class WorkflowStepRegistry extends EventTarget {

  readonly #kinds = new Map<string, WorkflowStepKind>()

  /** Register a kind. Idempotent for the same object; a different object
   *  under an existing key is a programming error and is dropped. */
  register(kind: WorkflowStepKind): void {
    if (!kind?.kind) throw new Error('[workflow-step-registry] kind.kind is required')
    const existing = this.#kinds.get(kind.kind)
    if (existing === kind) return
    if (existing) {
      console.warn(`[workflow-step-registry] duplicate kind "${kind.kind}" — ignoring re-registration`)
      return
    }
    this.#kinds.set(kind.kind, kind)
    this.dispatchEvent(new CustomEvent('change'))
  }

  unregister(kind: string): void {
    if (!this.#kinds.delete(kind)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  get(kind: string): WorkflowStepKind | undefined { return this.#kinds.get(kind) }

  all(): WorkflowStepKind[] { return [...this.#kinds.values()] }

  /**
   * The palette: registered kinds, plus every slash command the hive
   * currently answers to, as ready-made `command` steps.
   *
   * Derived on every call rather than cached — commands appear when a
   * module loads, and a palette that had to be invalidated would be a
   * palette that is sometimes wrong.
   */
  palette(): WorkflowPaletteEntry[] {
    const t = translator()
    const rows: WorkflowPaletteEntry[] = []

    for (const k of this.#kinds.values()) {
      rows.push({
        kind: k.kind,
        icon: k.icon,
        label: t(k.labelKey, k.label),
        description: t(k.descriptionKey, k.description ?? ''),
        group: k.group,
        fields: k.fields ?? [],
        seed: { v: 1, kind: k.kind },
      })
    }

    for (const behaviour of slashEntries()) {
      if (behaviour.hidden) continue
      rows.push({
        kind: 'command',
        icon: 'terminal',
        label: `/${behaviour.name}`,
        description: behaviour.description ?? '',
        group: 'command',
        command: behaviour.name,
        // The command is fixed by the row you picked; only its arguments are
        // yours to write.
        fields: ['args'],
        seed: { v: 1, kind: 'command', command: behaviour.name },
      })
    }

    const groupRank = { control: 0, behaviour: 1, command: 2 } as const
    return rows.sort((a, b) =>
      groupRank[a.group] - groupRank[b.group] || a.label.localeCompare(b.label))
  }
}

// ── the built-in kinds ────────────────────────────────────────────────
//
// `command` and `sub` have no `run` here: the runner owns them, because
// both need the runner's own machinery (the slash drone; the depth cap).
// `ask` and `note` are self-contained and carry their own.

const _registry = new WorkflowStepRegistry()
window.ioc.register('@diamondcoreprocessor.com/WorkflowStepRegistry', _registry)

_registry.register({
  kind: 'command',
  icon: 'terminal',
  label: 'Command',
  labelKey: 'workflow.kind.command',
  description: 'Run any slash command, with arguments.',
  descriptionKey: 'workflow.kind.command.description',
  group: 'control',
  fields: ['command', 'args'],
})

_registry.register({
  kind: 'sub',
  icon: 'account_tree',
  label: 'Sub-workflow',
  labelKey: 'workflow.kind.sub',
  description: "Run this step's own child tiles as a workflow.",
  descriptionKey: 'workflow.kind.sub.description',
  group: 'control',
})

_registry.register({
  kind: 'note',
  icon: 'sticky_note_2',
  label: 'Note',
  labelKey: 'workflow.kind.note',
  description: 'Write a line onto this step\'s tile as the run passes through.',
  descriptionKey: 'workflow.kind.note.description',
  group: 'control',
  fields: ['text'],
  async run(ctx) {
    const text = ctx.interpolate(ctx.step.text ?? '').trim()
    if (!text) return { status: 'skipped', detail: 'no text' }
    const notes = window.ioc.get<{
      addAtSegments?: (
        parentSegments: readonly string[], cellLabel: string, text: string,
      ) => Promise<void>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments) return { status: 'failed', detail: 'NotesService not available' }
    await notes.addAtSegments(ctx.segments.slice(0, -1), ctx.cell, text)
    return { status: 'done', detail: text.slice(0, 80) }
  },
})

_registry.register({
  kind: 'ask',
  icon: 'help',
  label: 'Ask',
  labelKey: 'workflow.kind.ask',
  description: 'Hand a question to an AI pass. Deposits the request and stops — the answer comes back in the feedback window.',
  descriptionKey: 'workflow.kind.ask.description',
  group: 'control',
  fields: ['text', 'model'],
  async run(ctx) {
    const request = ctx.interpolate(ctx.step.text ?? '').trim()
    if (!request) return { status: 'skipped', detail: 'no question' }
    const { depositRequest } = await import('./workflow-ask.js')
    await depositRequest({
      segments: ctx.segments,
      request,
      model: ctx.step.model,
      workflowName: ctx.workflowName,
    })
    return { status: 'asked', detail: request.slice(0, 80) }
  },
})

// ── helpers ───────────────────────────────────────────────────────────

type SlashEntry = { name: string; description?: string; hidden?: boolean }

/** Every slash behaviour the hive currently answers to. Empty when the
 *  slash drone has not loaded — the palette then shows control kinds only,
 *  which is correct rather than broken. */
function slashEntries(): SlashEntry[] {
  const slash = window.ioc.get<{ entries?: () => SlashEntry[] }>(
    '@diamondcoreprocessor.com/SlashBehaviourDrone',
  )
  try { return slash?.entries?.() ?? [] } catch { return [] }
}

function translator(): (key: string | undefined, fallback: string) => string {
  const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
  return (key, fallback) => {
    if (!key || !i18n) return fallback
    const translated = i18n.t(key)
    return translated === key ? fallback : translated
  }
}
