// comfy/comfy.queen.ts
//
// /comfy — make a picture with your own machine.
//
//   /comfy                          — open the ComfyUI window
//   /comfy a lantern in fog         — make that, onto the selected tile
//   /comfy host                     — where ComfyUI is, and whether it answers
//   /comfy host discover            — try the usual addresses
//   /comfy host 127.0.0.1:8188      — point somewhere else
//   /comfy folder                   — link ComfyUI's own folder (in the window)
//   /comfy workflow                 — the workflows this hive holds
//   /comfy workflow portrait        — work with that one
//   /comfy models                   — the checkpoints the host actually has
//   /comfy reroll                   — this tile's picture again, new seed
//   /comfy cancel                   — stop the run
//
// THE ARGUMENT IS A SENTENCE, AND THAT IS THE WHOLE DESIGN. Every other
// command object in this system walks members with dots, because its
// arguments are choices from a set. A prompt is not a choice from a set — it
// is prose, and prose is what a person types after `/comfy`. So the words are
// read as a prompt UNLESS the first one is a verb this behaviour owns, and
// the rest of the line is then handed to that verb WHOLE — which is why
// `/comfy host 127.0.0.1:8188` works when a dot-splitting walk would have
// made four segments of the address.
//
// The dropdown still teaches the verbs: they are the members at depth 0, so
// typing `/comfy ` offers `host`, `workflow`, `reroll` … and typing anything
// else is a prompt. A member list that also had to hold every possible
// sentence would be no list at all.
//
// WHY THE BARE WORD OPENS THE WINDOW rather than generating something: with
// no prompt there is nothing to make, and the window is where the prompt, the
// workflow, the size and the results all are. Same door, said twice.

import {
  QueenBee, EffectBus,
  registerCommandRoot, completeCommandPath,
  type CommandObject, type CommandMember,
} from '@hypercomb/core'
import { comfyFolder } from './comfy-folder.js'
import { comfyHost } from './comfy-host.js'
import { comfyService } from './comfy.service.js'
import {
  activeWorkflow,
  comfyWorkflows,
  setActiveWorkflow,
} from './comfy-workflows.js'

/** The verbs. A first word in this set is an instruction; anything else is
 *  the picture you want. */
const VERBS = new Set(['host', 'folder', 'workflow', 'workflows', 'models', 'checkpoints', 'reroll', 'cancel', 'stop'])

const comfyObject: CommandObject = {
  members(path: readonly string[]): readonly CommandMember[] {
    if (path.length === 0) {
      const reach = comfyHost.reach
      return [
        {
          name: 'host',
          description: reach.ok ? `answering at ${comfyHost.endpoint}` : 'where ComfyUI is',
        },
        {
          name: 'folder',
          description: comfyFolder.linked ? 'ComfyUI’s folder is linked' : 'link ComfyUI’s own folder',
          leaf: true,
        },
        { name: 'workflow', description: `working with "${activeWorkflow().label}"` },
        { name: 'models', description: 'the checkpoints this host has', leaf: true },
        { name: 'reroll', description: 'this tile’s picture again, new seed', leaf: true },
        { name: 'cancel', description: 'stop the run', leaf: true },
      ]
    }

    if (path[0] === 'host' && path.length === 1) {
      // The address itself is not a member — it is typed, and it holds dots
      // and a colon that no member name could survive.
      return [{ name: 'discover', description: 'try the usual addresses', leaf: true }]
    }

    if ((path[0] === 'workflow' || path[0] === 'workflows') && path.length === 1) {
      const active = activeWorkflow().id
      return comfyWorkflows().map(workflow => ({
        name: workflow.id,
        description: workflow.id === active ? `${workflow.label} — in use` : workflow.label,
        leaf: true,
      }))
    }

    return []
  },
}

registerCommandRoot('comfy', comfyObject)

export class ComfyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'comfy'
  override readonly aliases = ['comfyui']
  override description = 'Make a picture with ComfyUI and put it on a tile'
  override descriptionKey = 'slash.comfy'
  override options = [
    '<prompt>', 'host', 'host discover', 'host <address>', 'folder',
    'workflow', 'workflow <name>', 'models', 'reroll', 'cancel',
  ]
  override examples = [
    { input: '/comfy', result: 'Opens the ComfyUI window' },
    { input: '/comfy a paper lantern in fog', result: 'Generates that and puts it on the selected tile' },
    { input: '/comfy reroll', result: 'Makes this tile’s picture again with a new seed' },
  ]

  override slashComplete(args: string): readonly string[] {
    // Only complete while the line is still a verb. Once it is prose, a
    // dropdown offering `host` under a half-typed sentence is noise.
    //
    // SPLIT ON THE DOT TOO. `workflow.` is one word to a space-splitter, and
    // the trailing dot then matched no verb — so walking INTO a verb (the
    // whole point of the dot syntax) offered nothing. The first SEGMENT is
    // what decides, and a segment ends at either separator.
    const first = args.trim().split(/[\s.]+/)[0]?.toLowerCase() ?? ''
    if (first && !VERBS.has(first) && ![...VERBS].some(verb => verb.startsWith(first))) return []
    return completeCommandPath(comfyObject, args)
  }

  protected async execute(args: string): Promise<void> {
    const line = args.trim()
    if (!line) { EffectBus.emit('comfy:open', {}); return }

    // The verb takes the REST OF THE LINE whole — see the module comment.
    const [head, ...tail] = line.split(/[\s.]+/)
    const verb = (head ?? '').toLowerCase()
    const rest = line.slice((head ?? '').length).trim()

    if (!VERBS.has(verb)) return await this.#generate(line)

    switch (verb) {
      case 'host': return await this.#host(rest)
      case 'folder': {
        // A folder has to be CHOSEN, and a command line cannot open a file
        // picker — the browser requires the click to be the same gesture.
        // The window has the button, so the word lands you there.
        EffectBus.emit('comfy:open', { section: 'folder' })
        this.#log(comfyFolder.linked
          ? `ComfyUI folder linked${comfyFolder.label ? ` — ${comfyFolder.label}` : ''}`
          : 'pick ComfyUI’s folder in the window')
        return
      }
      case 'workflow':
      case 'workflows': return this.#workflow(tail[0] ?? '')
      case 'models':
      case 'checkpoints': return await this.#models()
      case 'reroll': {
        const results = await comfyService.reroll()
        if (!results.length) this.#log(comfyService.job.message ?? 'nothing to re-roll')
        return
      }
      case 'cancel':
      case 'stop': {
        await comfyService.cancel()
        this.#log('stopped')
        return
      }
      default: return
    }
  }

  // ── making one ──────────────────────────────────────────────────────────

  async #generate(prompt: string): Promise<void> {
    const cell = comfyService.targetCell()
    if (!cell) { this.#log('select a tile first — the picture goes on it'); return }

    this.#log(`${activeWorkflow().label} — "${prompt}" onto "${cell}"`, '◇')
    const results = await comfyService.run({ positive: prompt, cell, attach: true })
    if (!results.length) { this.#log(comfyService.job.message ?? 'no picture'); return }
    if (results.length > 1) {
      // The rest of a batch is not lost — the window is holding it, and that
      // is where you choose between them.
      this.#log(`${results.length} made — the window holds the rest`, '◇')
      EffectBus.emit('comfy:open', {})
    }
  }

  // ── where it runs ───────────────────────────────────────────────────────

  async #host(rest: string): Promise<void> {
    if (!rest) {
      const reach = await comfyHost.probe()
      this.#log(reach.ok
        ? `${comfyHost.endpoint} — answering${reach.version ? ` (ComfyUI ${reach.version})` : ''}`
        : `${comfyHost.endpoint} — ${reach.reason ?? 'no answer'}`)
      if (comfyFolder.linked) this.#log('ComfyUI folder linked — pictures read from disk', '▫')
      return
    }

    if (rest.toLowerCase() === 'discover') {
      this.#log('looking for ComfyUI…', '▫')
      const found = await comfyHost.discover()
      this.#log(found
        ? `found ComfyUI at ${found}`
        : 'no ComfyUI on the usual ports — start it, or give the address')
      return
    }

    const endpoint = comfyHost.setEndpoint(rest)
    const reach = await comfyHost.probe()
    this.#log(reach.ok ? `${endpoint} — answering` : `${endpoint} — ${reach.reason ?? 'no answer'}`)
  }

  // ── which recipe ────────────────────────────────────────────────────────

  #workflow(name: string): void {
    if (!name) {
      const active = activeWorkflow().id
      const all = comfyWorkflows()
      this.#log(`${all.length} workflow${all.length === 1 ? '' : 's'}`)
      for (const workflow of all) {
        this.#log(`${workflow.id} — ${workflow.label}`, workflow.id === active ? '◈' : '▫')
      }
      return
    }
    this.#log(setActiveWorkflow(name)
      ? `working with "${activeWorkflow().label}"`
      : `no workflow named "${name}"`)
  }

  async #models(): Promise<void> {
    const models = await comfyService.checkpoints()
    if (!models.length) { this.#log('the host named no checkpoints — is it answering?'); return }
    this.#log(`${models.length} checkpoint${models.length === 1 ? '' : 's'} on ${comfyHost.endpoint}`)
    for (const model of models) this.#log(model, '▫')
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _comfy = new ComfyQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/ComfyQueenBee', _comfy)
