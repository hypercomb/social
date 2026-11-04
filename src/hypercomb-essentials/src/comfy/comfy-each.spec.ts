// comfy/comfy-each.spec.ts — `comfy each`: one picture for every selected
// tile, each prompted by that tile's own name and landing on it, one at a
// time; Stop ends the run between tiles; a host that is not answering is one
// sentence and the desk, never a queue of failures.
//
// The host is faked at its seam: `queue` records the prompt each graph carries
// and `history` answers with one file, so the run is the service's own code
// from the selection to `cell:attach-resource`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  reach: { ok: true } as { ok: boolean; reason?: string },
  prompts: [] as string[],
  onHistory: null as null | ((promptId: string) => Promise<unknown>),
  selected: new Set<string>(),
}))

vi.mock('./comfy-host.js', () => {
  class ComfyHost {
    static filesOf(run: { files?: unknown[] } | null): unknown[] { return run?.files ?? [] }
  }
  const comfyHost = {
    endpoint: 'http://127.0.0.1:8188',
    get reach() { return host.reach },
    probe: async () => host.reach,
    queue: async (graph: Record<string, { inputs: Record<string, unknown> }>) => {
      host.prompts.push(String(graph['1']?.inputs['text'] ?? ''))
      return `p${host.prompts.length}`
    },
    history: async (promptId: string) => host.onHistory
      ? host.onHistory(promptId)
      : { status: { completed: true }, outputs: { '9': {} }, files: [{ filename: `${promptId}.png`, subfolder: '', type: 'output' }] },
    fetchFile: async () => new Blob(['png']),
    listen: () => undefined,
    interrupt: async () => undefined,
    choicesFor: async () => [],
  }
  return { ComfyHost, comfyHost }
})
vi.mock('./comfy-recipes.js', () => ({ readyRecipes: async () => undefined }))
vi.mock('./comfy-folder.js', () => ({
  comfyFolder: { linked: false, label: '' },
  importable: () => true,
  tooLargeMessage: () => 'too large',
}))
vi.mock('./comfy-workflows.js', () => {
  const workflow = {
    kind: 'comfy-workflow@1', id: 'w', label: 'Tile',
    graph: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } },
    seams: { positive: { node: '1', input: 'text' } },
  }
  return {
    activeWorkflow: () => workflow,
    comfyWorkflow: () => undefined,
    comfyWorkflows: () => [workflow],
    setActiveWorkflow: () => true,
  }
})
vi.mock('../editor/arm-resource.js', () => ({
  storeImageResources: async () => ({ largeSig: 'a'.repeat(64), smallPointSig: null, smallFlatSig: null, previewUrl: '' }),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    whenReady: () => {},
    get: (key: string) => key === '@diamondcoreprocessor.com/SelectionService'
      ? { selected: host.selected, remove: (label: string) => { host.selected.delete(label) } }
      : undefined,
  }
})

import { EffectBus } from '@hypercomb/core'
import { comfyService, promptFromName } from './comfy.service.js'
import { ComfyQueenBee } from './comfy.queen.js'

const run = (args: string) => (new ComfyQueenBee() as unknown as { execute(a: string): Promise<void> }).execute(args)

let landed: string[] = []
let opened: unknown[] = []
let logs: string[] = []
const subs: (() => void)[] = []

beforeEach(() => {
  host.reach = { ok: true }
  host.prompts = []
  host.onHistory = null
  host.selected = new Set(['brass-lantern', 'fog', 'garden'])
  landed = []
  opened = []
  logs = []
  subs.push(
    EffectBus.on<{ cell: string }>('cell:attach-resource', p => { landed.push(p.cell) }),
    EffectBus.on('comfy:open', p => { opened.push(p) }),
    EffectBus.on<{ message: string }>('activity:log', p => { logs.push(p.message) }),
  )
  // last values from an earlier test must not replay into the next one
  landed = []
  opened = []
  logs = []
})
afterEach(() => { while (subs.length) subs.pop()!() })

describe('comfy each', () => {
  it('a tile name is a prompt in words', () => {
    expect(promptFromName('brass-lantern')).toBe('brass lantern')
    expect(promptFromName('fog')).toBe('fog')
  })

  it('makes one picture per selected tile, each prompted by its own name, onto that tile, in order', async () => {
    await run('each')
    expect(host.prompts).toEqual(['brass lantern', 'fog', 'garden'])
    expect(landed).toEqual(['brass-lantern', 'fog', 'garden'])
    expect(opened).toEqual([])
    expect(logs.some(m => m.includes('(2/3)'))).toBe(true)
    expect(comfyService.job.state).toBe('done')
  })

  it('stops between tiles when cancelled: the tiles already painted keep their pictures', async () => {
    host.onHistory = async (promptId) => {
      if (promptId === 'p2') { await comfyService.cancel(); return null }
      return { status: { completed: true }, outputs: { '9': {} }, files: [{ filename: `${promptId}.png`, subfolder: '', type: 'output' }] }
    }
    await run('each')
    expect(host.prompts).toEqual(['brass lantern', 'fog'])
    expect(landed).toEqual(['brass-lantern'])
  }, 10_000)

  it('a host that is not answering is said once and opens the desk — nothing is queued', async () => {
    host.reach = { ok: false, reason: 'connection refused' }
    await run('each')
    expect(host.prompts).toEqual([])
    expect(landed).toEqual([])
    expect(opened).toEqual([{ section: 'host' }])
    expect(logs.some(m => m.includes('not answering') && m.includes('connection refused'))).toBe(true)
  })

  it('with nothing selected it asks for tiles and runs nothing', async () => {
    host.selected = new Set()
    await run('each')
    expect(host.prompts).toEqual([])
    expect(opened).toEqual([])
  })

  it('is a verb the dropdown teaches, not a prompt', async () => {
    const queen = new ComfyQueenBee()
    expect(queen.slashComplete('ea')).toContain('each')
  })
})
