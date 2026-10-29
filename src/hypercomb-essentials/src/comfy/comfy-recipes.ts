// comfy/comfy-recipes.ts
//
// WORKFLOWS THIS MACHINE CAN ALREADY RUN.
//
// A pasted workflow is content, and it travels. These do not. Each one names
// files that live on this ComfyUI and nowhere else, so they are registered
// only after `/object_info` says those files are there, and they are never
// written into `comfy:workflows`. A hive that published them would be handing
// someone a graph their server cannot run.
//
// Klein's checkpoint seam is deleted after inference. The seam walker treats
// `unet_name` as a checkpoint, and the run would then substitute the first
// SD checkpoint into that field. The diffusion model stays the one the graph
// names.

import { isReservedPoolWord } from '@hypercomb/core'
import { comfyHost } from './comfy-host.js'
import {
  parseComfyWorkflow,
  type ComfyGraph,
  type ComfyWorkflowSpec,
} from './comfy-workflow.js'
import {
  BUILTIN_WORKFLOW_ID,
  preferredWorkflowId,
  registerComfyWorkflow,
  setActiveWorkflow,
} from './comfy-workflows.js'

const KLEIN_UNET = 'flux3-image-klein-int8-convrot.safetensors'
const KLEIN_CLIP = 'qwen3vl_4b_int8_convrot.safetensors'
const KLEIN_VAE = 'flux2-vae.safetensors'
const SDXL_CKPT = 'sd_xl_base_1.0.safetensors'
const SDXL_LIGHTNING = 'sdxl_lightning_8step_lora.safetensors'
const SDXL_DETAIL = 'add-detail-xl.safetensors'
const SDXL_ICON = 'icons-redmond-v2.safetensors'

const KLEIN_TILE_PROMPT = 'A rich hexagonal ceramic tile face, deep teal glaze with gold leaf veins, soft studio light, sharp macro detail, no text'
const KLEIN_BACKGROUND_PROMPT = 'A wide atmospheric background, dusk over a hexagonal stone courtyard, warm lantern light in fog, rich color, cinematic depth, no text'
const SDXL_TILE_PROMPT = 'A rich illustrated tile, ornate hexagonal emblem, jewel tones, crisp edges, painterly light, no text'
const SDXL_BACKGROUND_PROMPT = 'A wide rich background, layered clouds at golden hour over a dark sea, cinematic color, fine detail, no text'
const SDXL_ICON_SUBJECT = 'a single gold compass'
const SDXL_ICON_TRIGGER = 'icredm, icons, app icon'

const SKIP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'to', 'from', 'over', 'at', 'into', 'by'])

/** A tile name from the prompt: up to three words, then the seed's last digits.
 *  Hyphens, because a tile name folds spaces to hyphens at the create door. */
export const pictureTileName = (prompt: string, seed: number): string => {
  const tail = String(Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0))).slice(-4) || '0'
  const words: string[] = []
  for (const raw of String(prompt ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || SKIP.has(raw) || isReservedPoolWord(raw)) continue
    words.push(raw)
    if (words.length === 3) break
  }
  const base = words.length ? words.join('-') : 'picture'
  return `${base}-${tail}`
}

const kleinGraph = (prompt: string, width: number, height: number): ComfyGraph => ({
  '1': { class_type: 'UNETLoader', inputs: { unet_name: KLEIN_UNET, weight_dtype: 'default' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: KLEIN_CLIP, type: 'flux3', device: 'cpu' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: KLEIN_VAE } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '6': { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: 1 } },
  '7': {
    class_type: 'KSampler',
    inputs: {
      seed: 1, steps: 15, cfg: 1, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1,
      model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'hypercomb', images: ['8', 0] } },
})

const sdxlGraph = (prompt: string, width: number, height: number): ComfyGraph => ({
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SDXL_CKPT } },
  '10': {
    class_type: 'LoraLoader',
    inputs: {
      model: ['4', 0], clip: ['4', 1], lora_name: SDXL_LIGHTNING,
      strength_model: 1, strength_clip: 1,
    },
  },
  '11': {
    class_type: 'LoraLoader',
    inputs: {
      model: ['10', 0], clip: ['10', 1], lora_name: SDXL_DETAIL,
      strength_model: 0.65, strength_clip: 0.65,
    },
  },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['11', 1] } },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'blurry, watermark, text, logo, low detail, deformed, oversaturated',
      clip: ['11', 1],
    },
  },
  '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1, steps: 8, cfg: 2, sampler_name: 'euler', scheduler: 'sgm_uniform', denoise: 1,
      model: ['11', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'hypercomb', images: ['8', 0] } },
})

/**
 * One LoRA, no Lightning. The trigger lives on its own encoder. The subject
 * is the first conditioning into the combine, so the positive seam is that
 * node and a new prompt leaves the trigger where it is.
 */
const sdxlIconGraph = (subject: string): ComfyGraph => ({
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SDXL_CKPT } },
  '10': {
    class_type: 'LoraLoader',
    inputs: {
      model: ['4', 0], clip: ['4', 1], lora_name: SDXL_ICON,
      strength_model: 0.8, strength_clip: 0.8,
    },
  },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: subject, clip: ['10', 1] } },
  '12': { class_type: 'CLIPTextEncode', inputs: { text: SDXL_ICON_TRIGGER, clip: ['10', 1] } },
  '13': {
    class_type: 'ConditioningCombine',
    inputs: { conditioning_1: ['6', 0], conditioning_2: ['12', 0] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'photograph, blurry, text, letters, words, watermark, many objects, scenery, frame',
      clip: ['10', 1],
    },
  },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1, steps: 24, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
      model: ['10', 0], positive: ['13', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'hypercomb', images: ['8', 0] } },
})

const recipe = (
  graph: ComfyGraph,
  id: string,
  label: string,
  description: string,
  dropCheckpoint: boolean,
): ComfyWorkflowSpec => {
  const spec = parseComfyWorkflow(graph, label)
  spec.id = id
  spec.label = label
  spec.description = description
  if (dropCheckpoint) delete spec.seams.checkpoint
  // A filled seed would repeat the same picture and the same tile name.
  // Blank means the run mints a new one, and the field stays editable.
  const seed = spec.seams.seed
  if (seed) spec.graph[seed.node]!.inputs[seed.input] = ''
  return spec
}

/** Square Klein face. No checkpoint seam — see the file comment. */
export const kleinTile = (): ComfyWorkflowSpec => recipe(
  kleinGraph(KLEIN_TILE_PROMPT, 1024, 1024),
  'klein-tile',
  'Klein tile',
  'FLUX.3 Klein distilled INT8. Square face for a tile. The text encoder stays on CPU so the 8 GB card holds the sampler.',
  true,
)

export const kleinBackground = (): ComfyWorkflowSpec => recipe(
  kleinGraph(KLEIN_BACKGROUND_PROMPT, 1280, 720),
  'klein-background',
  'Klein background',
  'FLUX.3 Klein distilled INT8. Wide background. The text encoder stays on CPU.',
  true,
)

export const sdxlRichTile = (): ComfyWorkflowSpec => recipe(
  sdxlGraph(SDXL_TILE_PROMPT, 1024, 1024),
  'sdxl-rich-tile',
  'SDXL rich tile',
  'SDXL with the Lightning 8-step LoRA and Add Detail XL. Fast rich tile faces.',
  false,
)

export const sdxlRichBackground = (): ComfyWorkflowSpec => recipe(
  sdxlGraph(SDXL_BACKGROUND_PROMPT, 1344, 768),
  'sdxl-rich-background',
  'SDXL rich background',
  'SDXL with the Lightning 8-step LoRA and Add Detail XL. Wide background.',
  false,
)

export const sdxlIcon = (): ComfyWorkflowSpec => recipe(
  sdxlIconGraph(SDXL_ICON_SUBJECT),
  'sdxl-icon',
  'SDXL icon',
  'SDXL with Icons Redmond. A square app icon. The trigger stays beside the subject.',
  false,
)

const has = (names: readonly string[], file: string): boolean => names.includes(file)

let offeredEndpoint = ''
let inflight: Promise<void> | null = null

/**
 * Ask the server what it can run and put those workflows on the roster.
 * A server that is down is not remembered, so the next open tries again.
 * An explicit workflow choice is left alone. The built-in, or no choice,
 * becomes Klein when those files are present, otherwise the SDXL tile.
 */
export const readyRecipes = (): Promise<void> => {
  if (!inflight) inflight = offer().finally(() => { inflight = null })
  return inflight
}

const offer = async (): Promise<void> => {
  let reach = comfyHost.reach.ok ? comfyHost.reach : await comfyHost.probe()
  if (!reach.ok) {
    const found = await comfyHost.discover()
    if (!found) return
    reach = comfyHost.reach
  }
  const endpoint = comfyHost.endpoint
  if (offeredEndpoint === endpoint) return

  const [unets, clips, vaes, checkpoints, loras] = await Promise.all([
    comfyHost.choicesFor('UNETLoader', 'unet_name'),
    comfyHost.choicesFor('CLIPLoader', 'clip_name'),
    comfyHost.choicesFor('VAELoader', 'vae_name'),
    comfyHost.choicesFor('CheckpointLoaderSimple', 'ckpt_name'),
    comfyHost.choicesFor('LoraLoader', 'lora_name'),
  ])

  const klein = has(unets, KLEIN_UNET) && has(clips, KLEIN_CLIP) && has(vaes, KLEIN_VAE)
  const sdxl = has(checkpoints, SDXL_CKPT) && has(loras, SDXL_LIGHTNING) && has(loras, SDXL_DETAIL)
  const icon = has(checkpoints, SDXL_CKPT) && has(loras, SDXL_ICON)
  if (klein) {
    registerComfyWorkflow(kleinTile())
    registerComfyWorkflow(kleinBackground())
  }
  if (sdxl) {
    registerComfyWorkflow(sdxlRichTile())
    registerComfyWorkflow(sdxlRichBackground())
  }
  if (icon) registerComfyWorkflow(sdxlIcon())

  const heard = unets.length + clips.length + vaes.length + checkpoints.length + loras.length
  if (!klein && !sdxl && !icon && heard === 0) return
  offeredEndpoint = endpoint

  const chosen = preferredWorkflowId()
  if (chosen && chosen !== BUILTIN_WORKFLOW_ID) return
  if (klein) setActiveWorkflow('klein-tile')
  else if (sdxl) setActiveWorkflow('sdxl-rich-tile')
}
