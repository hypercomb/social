// diamondcoreprocessor.com/workflow/workflow.queen.ts
//
// `/workflow` — the designer, and the way to run one from the keyboard.
//
//   /workflow                 open the designer beside the canvas
//   /workflow new <name>      make the cell you are standing in a workflow
//   /workflow run             run the workflow you are standing in
//   /workflow run <name>      run a named workflow (a SKILL) from anywhere
//   /workflow step            run it one step at a time
//   /workflow stop            abandon the run in progress
//   /workflow list            every named workflow the hive can reach
//
// The panel is shell UI (hypercomb-shared/ui/workflow-designer); this queen
// only fires effects, keeping the essentials/shell boundary clean — the same
// split `/tags` uses.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { listWorkflows, nameWorkflow, readWorkflow, WORKFLOW_SLOT } from './workflow-slot.js'

// Keeps the slot registration alive against tree-shaking (the tutor slot uses
// the same trick via its renderer).
void WORKFLOW_SLOT

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/

const toast = (type: 'info' | 'success' | 'warning', message: string): void => {
  try { EffectBus.emit('toast:show', { type, title: 'Workflow', message }) } catch { /* noop */ }
}

type LineageLike = { explorerSegments?: () => readonly string[] }

const currentSegments = (): string[] => {
  const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
  return [...(lineage?.explorerSegments?.() ?? [])]
}

export class WorkflowQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'workflow'
  override readonly aliases = ['flow', 'skill']
  override description =
    'Design a workflow out of tiles — one step per tile — and run it. A named workflow is a skill the hive can run from anywhere.'
  override descriptionKey = 'slash.workflow'
  override options = ['new <name>', 'run [name]', 'step', 'stop', 'list']
  override examples = [
    { input: '/workflow', result: 'Opens the designer beside the canvas' },
    { input: '/workflow new onboard a peer', result: 'Makes this tile a workflow; its child tiles are the steps' },
    { input: '/workflow run onboard a peer', result: 'Runs that skill from wherever you are standing' },
  ]

  override slashComplete(args: string): readonly string[] {
    const tokens = args.trim().split(/\s+/).filter(Boolean)
    const verbs = ['new', 'run', 'step', 'stop', 'list']
    if (tokens.length === 0) return verbs
    if (tokens.length === 1 && !args.endsWith(' ')) {
      return verbs.filter(v => v.startsWith(tokens[0].toLowerCase()))
    }
    if (tokens[0].toLowerCase() === 'run') {
      const q = tokens.slice(1).join(' ').toLowerCase()
      const names = this.#cachedNames
      return q ? names.filter(n => n.toLowerCase().startsWith(q)) : names
    }
    return []
  }

  /** Names for autocomplete. Refreshed by `list` and after every `new`;
   *  autocomplete is synchronous, so it cannot do the async read itself. */
  #cachedNames: string[] = []

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb, ...rest] = trimmed.split(/\s+/).filter(Boolean)
    const tail = rest.join(' ').trim()

    switch ((verb ?? '').toLowerCase()) {
      case '':      EffectBus.emit('workflow:view-open', {}); return
      case 'new':   await this.#declare(tail); return
      case 'run':   await this.#run(tail, false); return
      case 'step':  await this.#run(tail, true); return
      case 'stop':  EffectBus.emit('workflow:run-stop', {}); return
      case 'list':  await this.#list(); return
      default:
        console.warn('[/workflow] usage: /workflow [new <name> | run [name] | step | stop | list]')
        toast('warning', 'Try: /workflow new <name>, /workflow run, /workflow list')
    }
  }

  /** Make the cell you are standing in a workflow. The steps are whatever
   *  child tiles it has — including none yet, which is the normal way to
   *  start: declare it, then add tiles.
   *
   *  At the hive ROOT there is no tile to name, so this MINTS one instead of
   *  refusing — the root has no tile of its own, which is a fact about the
   *  root, not a reason to send the participant away empty-handed. */
  async #declare(name: string): Promise<void> {
    const segments = currentSegments()
    if (!name) {
      toast('warning', 'Give it a name: /workflow new <name>')
      return
    }
    if (!NAME_RE.test(name)) {
      toast('warning', 'Use letters, digits, spaces, - . _ (max 64)')
      return
    }

    EffectBus.emit('workflow:view-open', {})

    if (!segments.length) {
      // The drone creates the tile, declares it, and walks in.
      EffectBus.emit('workflow:create', { segments, name })
      return
    }

    await nameWorkflow({ segments, name, at: Date.now() })
    this.#cachedNames = [...new Set([...this.#cachedNames, name])].sort()
    toast('success', `"${name}" is a workflow — its child tiles are its steps`)
    EffectBus.emit('workflow:changed', { segments })
  }

  /** Run the workflow you are standing in, or a named one from anywhere. */
  async #run(name: string, stepThrough: boolean): Promise<void> {
    let segments = currentSegments()

    if (name) {
      const match = (await listWorkflows())
        .find(w => w.name.toLowerCase() === name.toLowerCase())
      if (!match) {
        toast('warning', `No workflow named "${name}" — /workflow list shows them`)
        return
      }
      segments = [...match.segments]
    } else if (!(await readWorkflow(segments))) {
      toast('warning', 'This tile is not a workflow yet — /workflow new <name>')
      return
    }

    EffectBus.emit('workflow:view-open', {})
    EffectBus.emit('workflow:run', { segments, stepThrough })
  }

  async #list(): Promise<void> {
    const workflows = await listWorkflows()
    this.#cachedNames = workflows.map(w => w.name).sort()
    if (!workflows.length) {
      console.log('[/workflow] no named workflows yet')
      toast('info', 'No named workflows yet — /workflow new <name>')
      return
    }
    for (const w of workflows) {
      console.log(`[/workflow] ${w.name} → /${w.segments.join('/')}${w.record.description ? ` — ${w.record.description}` : ''}`)
    }
    toast('info', `${workflows.length} workflow${workflows.length === 1 ? '' : 's'} — see the console`)
  }
}

const _workflow = new WorkflowQueenBee()
window.ioc.register('@diamondcoreprocessor.com/WorkflowQueenBee', _workflow)

// ── the behaviour ─────────────────────────────────────────────────────
//
// A workflow is a first-class behaviour, so it gets the same treatment every
// other one does: a toggle on the command line when the cell you are on has
// a `workflow` slot, and an adoption opt-in.
//
// `adoptScope: 'hierarchy'` is the load-bearing field. A workflow's content
// IS its child subtree — the steps — so adopting the behaviour has to carry
// the tiles, not just the host cell's slot. This is what makes a skill
// shareable at all: a peer folds the whole thing, signature-verified,
// and can then fork it by editing tiles like any other part of their hive.
;(window as {
  ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void }
}).ioc?.whenReady?.<{ register(bee: Record<string, unknown>): void }>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'workflow',
      slashCommand: '/workflow',
      iconName: 'workflow',
      toggleIcon: 'account_tree',
      decorationKind: 'visual:workflow:step',
      slot: WORKFLOW_SLOT,
      labelKey: 'view.workflow',
      descriptionKey: 'view.workflow.description',
      queenKey: '@diamondcoreprocessor.com/WorkflowQueenBee',
      adoptable: true,
      adoptScope: 'hierarchy',
      resourceScope: 'layer',
    })
  },
)
