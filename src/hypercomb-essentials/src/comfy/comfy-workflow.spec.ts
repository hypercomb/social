import { describe, expect, it } from 'vitest'
import {
  applyParams,
  inferSeams,
  offeredKnobs,
  parseComfyWorkflow,
  readParams,
  workflowSlug,
  type ComfyGraph,
} from './comfy-workflow.js'
import { mixedContentBlocked, normalizeEndpoint } from './comfy-host.js'
import { MAX_IMPORT_BYTES, importable, tooLargeMessage } from './comfy-folder.js'

/** ComfyUI's own default text-to-image graph, with the two encoders in the
 *  order the editor writes them. */
const defaultGraph = (): ComfyGraph => ({
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 42, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a lantern', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'hypercomb', images: ['8', 0] } },
})

describe('inferSeams', () => {
  it('reads the two prompts from the sampler links, not from graph order', () => {
    const seams = inferSeams(defaultGraph())
    expect(seams.positive).toEqual({ node: '6', input: 'text' })
    expect(seams.negative).toEqual({ node: '7', input: 'text' })
  })

  it('still gets them right when the negative encoder is written FIRST', () => {
    // The failure mode a class-name match has: node "2" is the negative here,
    // and it is the first CLIPTextEncode in the object.
    const graph: ComfyGraph = {
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'watermark', clip: ['4', 1] } },
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 12, cfg: 7, positive: ['5', 0], negative: ['2', 0], latent_image: ['6', 0] },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
      '5': { class_type: 'CLIPTextEncode', inputs: { text: 'a cathedral', clip: ['4', 1] } },
      '6': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 2 } },
      '7': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
    }
    const seams = inferSeams(graph)
    expect(seams.positive).toEqual({ node: '5', input: 'text' })
    expect(seams.negative).toEqual({ node: '2', input: 'text' })
  })

  it('walks through conditioning nodes between the encoder and the sampler', () => {
    const graph: ComfyGraph = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a harbour at dawn', clip: ['1', 1] } },
      '3': { class_type: 'ConditioningSetArea', inputs: { conditioning: ['2', 0], width: 64, height: 64 } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'noise', clip: ['1', 1] } },
      '5': {
        class_type: 'KSampler',
        inputs: { seed: 0, steps: 20, cfg: 8, positive: ['3', 0], negative: ['4', 0], latent_image: ['6', 0] },
      },
      '6': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '7': { class_type: 'SaveImage', inputs: { images: ['5', 0] } },
    }
    const seams = inferSeams(graph)
    expect(seams.positive).toEqual({ node: '2', input: 'text' })
    expect(seams.negative).toEqual({ node: '4', input: 'text' })
  })

  it('offers no negative seam when one encoder feeds both slots', () => {
    const graph = defaultGraph()
    graph['3']!.inputs['negative'] = ['6', 0]
    const seams = inferSeams(graph)
    expect(seams.positive).toEqual({ node: '6', input: 'text' })
    expect(seams.negative).toBeUndefined()
    expect(offeredKnobs(seams)).not.toContain('negative')
  })

  it('takes the size and batch from the latent the sampler is given', () => {
    const seams = inferSeams(defaultGraph())
    expect(seams.width).toEqual({ node: '5', input: 'width' })
    expect(seams.height).toEqual({ node: '5', input: 'height' })
    expect(seams.batch).toEqual({ node: '5', input: 'batch_size' })
  })

  it('finds KSamplerAdvanced’s seed under its own name', () => {
    const graph: ComfyGraph = {
      '1': {
        class_type: 'KSamplerAdvanced',
        inputs: { noise_seed: 7, steps: 30, cfg: 6, positive: ['2', 0], negative: ['3', 0] },
      },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'b' } },
    }
    expect(inferSeams(graph).seed).toEqual({ node: '1', input: 'noise_seed' })
  })

  it('prefers SaveImage over PreviewImage as the output', () => {
    const graph = defaultGraph()
    graph['10'] = { class_type: 'PreviewImage', inputs: { images: ['8', 0] } }
    expect(inferSeams(graph).output).toEqual({ node: '9' })
  })

  it('falls back to the node nothing links to when there is no save node', () => {
    const graph: ComfyGraph = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a' } },
      '2': { class_type: 'SomeCustomOutput', inputs: { images: ['1', 0] } },
    }
    expect(inferSeams(graph).output).toEqual({ node: '2' })
  })

  it('answers empty seams for something that is not a graph', () => {
    expect(inferSeams({} as ComfyGraph)).toEqual({})
    expect(inferSeams(null as unknown as ComfyGraph)).toEqual({})
  })
})

describe('parseComfyWorkflow', () => {
  it('accepts a bare API-format graph — what ComfyUI actually saves', () => {
    const spec = parseComfyWorkflow(defaultGraph(), 'Portrait')
    expect(spec.kind).toBe('comfy-workflow@1')
    expect(spec.id).toBe('portrait')
    expect(spec.seams.positive).toEqual({ node: '6', input: 'text' })
  })

  it('accepts a JSON string', () => {
    const spec = parseComfyWorkflow(JSON.stringify(defaultGraph()))
    expect(Object.keys(spec.graph)).toHaveLength(7)
  })

  it('lets a declared seam beat the inferred one', () => {
    const spec = parseComfyWorkflow({
      kind: 'comfy-workflow@1',
      id: 'mine',
      label: 'Mine',
      graph: defaultGraph(),
      seams: { positive: { node: '7', input: 'text' } },
    })
    expect(spec.seams.positive).toEqual({ node: '7', input: 'text' })
    // Everything it did not restate is still inferred.
    expect(spec.seams.width).toEqual({ node: '5', input: 'width' })
  })

  it('names the editor save for what it is', () => {
    expect(() => parseComfyWorkflow({ nodes: [], links: [] }))
      .toThrow(/Save \(API Format\)/)
  })

  it('refuses what is not a graph, with a reason', () => {
    expect(() => parseComfyWorkflow('nope')).toThrow(/not JSON/)
    expect(() => parseComfyWorkflow({ hello: 'world' })).toThrow(/no ComfyUI nodes/)
  })
})

describe('applyParams', () => {
  it('writes at the seams and never touches the source graph', () => {
    const source = defaultGraph()
    const seams = inferSeams(source)
    const out = applyParams(source, seams, { positive: 'a lighthouse', seed: 99, width: 1024 })
    expect(out['6']!.inputs['text']).toBe('a lighthouse')
    expect(out['3']!.inputs['seed']).toBe(99)
    expect(out['5']!.inputs['width']).toBe(1024)
    // The saved workflow is unchanged — it is content, and its signature
    // must not move because somebody typed a prompt.
    expect(source['6']!.inputs['text']).toBe('a lantern')
    expect(source['3']!.inputs['seed']).toBe(42)
  })

  it('drops a value whose seam the workflow does not have', () => {
    const source = defaultGraph()
    const seams = inferSeams(source)
    delete seams.negative
    const out = applyParams(source, seams, { negative: 'blurry, watermark' })
    expect(out['7']!.inputs['text']).toBe('blurry')
  })

  it('leaves the author’s value alone when a param is unset', () => {
    const source = defaultGraph()
    const out = applyParams(source, inferSeams(source), { positive: 'x' })
    expect(out['3']!.inputs['steps']).toBe(20)
    expect(out['4']!.inputs['ckpt_name']).toBe('sd15.safetensors')
  })
})

describe('readParams', () => {
  it('reads back what the seams hold, for a form that opens on real values', () => {
    const graph = defaultGraph()
    expect(readParams(graph, inferSeams(graph))).toMatchObject({
      positive: 'a lantern', negative: 'blurry', seed: 42, steps: 20, cfg: 8,
      width: 512, height: 512, batch: 1, checkpoint: 'sd15.safetensors',
    })
  })
})

describe('workflowSlug', () => {
  it('makes something typeable after a dot', () => {
    expect(workflowSlug('SDXL — Portrait v2')).toBe('sdxl-portrait-v2')
    expect(workflowSlug('!!!')).toBe('')
  })
})

describe('normalizeEndpoint', () => {
  it('assumes http for the bare address people actually type', () => {
    expect(normalizeEndpoint('localhost:8188')).toBe('http://localhost:8188')
    expect(normalizeEndpoint('127.0.0.1:8818/')).toBe('http://127.0.0.1:8818')
    expect(normalizeEndpoint('https://comfy.example.com')).toBe('https://comfy.example.com')
    expect(normalizeEndpoint('   ')).toBe('')
  })
})

describe('mixedContentBlocked', () => {
  it('lets an https page reach http on localhost — the browser does', () => {
    expect(mixedContentBlocked('http://127.0.0.1:8188', 'https:', 'hypercomb.io')).toBe(false)
    expect(mixedContentBlocked('http://localhost:8188', 'https:', 'hypercomb.io')).toBe(false)
  })

  it('blocks an https page reaching plain http on the LAN', () => {
    expect(mixedContentBlocked('http://192.168.1.40:8188', 'https:', 'hypercomb.io')).toBe(true)
  })

  it('is not a rule at all for an http page', () => {
    expect(mixedContentBlocked('http://192.168.1.40:8188', 'http:', 'localhost')).toBe(false)
  })
})

describe('the import cap', () => {
  it('lets an ordinary generation through', () => {
    expect(importable(6 * 1024 * 1024)).toBe(true)
  })

  it('refuses what a tile face should not carry into every publish', () => {
    expect(importable(MAX_IMPORT_BYTES + 1)).toBe(false)
    expect(importable(0)).toBe(false)
    expect(tooLargeMessage(50 * 1024 * 1024)).toContain('50.0 MB')
  })
})
