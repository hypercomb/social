// comfy/comfy-workflow.ts
//
// A COMFYUI WORKFLOW IS CONTENT, AND ITS SEAMS ARE INFERRED.
//
// ComfyUI's API format is a node graph: `{ "3": { class_type, inputs } }`,
// where an input is either a literal or a link `[nodeId, slot]`. It says
// everything about how the picture is made and NOTHING about which of its
// four hundred numbers a person would want to change. A participant does not
// want to edit node 6's `text` field; they want to type a prompt.
//
// So a workflow arrives here as a graph and leaves as a SPEC: the same graph
// plus SEAMS — the handful of (node, input) addresses that carry the prompt,
// the negative, the seed, the size, the checkpoint. The seams are inferred
// from the graph's own shape, which is the whole point: any workflow exported
// from ComfyUI's "Save (API format)" works the moment it is pasted, with no
// per-workflow code, no mapping UI and no fields to fill in. A workflow that
// declares its own seams (because inference guessed wrong, or because the
// author wants a different knob exposed) simply overrides them — declaration
// beats inference, inference beats nothing.
//
// WHY WALK THE LINKS INSTEAD OF MATCHING CLASS NAMES. The naive reading is
// "the positive prompt is the first CLIPTextEncode" — and it is wrong for
// every workflow that puts the negative first in the JSON, which is most of
// them, because node order is insertion order in the editor. The graph
// already says which is which: the sampler has inputs named `positive` and
// `negative`, and each is a link. Following the link is not cleverness, it is
// reading what the author wrote. The same walk survives ConditioningCombine,
// ConditioningSetArea and every other node between the encoder and the
// sampler, because it is a search for "the first node upstream that holds
// TEXT", not a search for a class name.
//
// PURE ON PURPOSE. Nothing in this file touches the network, the DOM, the
// store or `window`. A workflow can be parsed, inspected and parameterised
// with no ComfyUI running anywhere — which is what makes the inference
// testable, and what lets the window show a pasted workflow's seams before
// the participant has a host to send it to.

/** One node in ComfyUI's API format. */
export interface ComfyNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

/** The whole graph, keyed by node id (a string of digits, by convention). */
export type ComfyGraph = Record<string, ComfyNode>

/** One place a value can be written. */
export interface ComfySeam {
  node: string
  input: string
}

/**
 * THE KNOBS. Every one is optional: a workflow that has no negative prompt
 * has no negative seam, and a surface offering the field would be lying about
 * what the workflow does. Absence is the honest answer, so the window renders
 * from this object rather than from a fixed form.
 */
export interface ComfySeams {
  positive?: ComfySeam
  negative?: ComfySeam
  seed?: ComfySeam
  steps?: ComfySeam
  cfg?: ComfySeam
  sampler?: ComfySeam
  scheduler?: ComfySeam
  width?: ComfySeam
  height?: ComfySeam
  batch?: ComfySeam
  checkpoint?: ComfySeam
  /** A LoadImage node's file name — the img2img seam. */
  image?: ComfySeam
  /** Which node's outputs are the pictures. */
  output?: { node: string }
}

/** The values a caller may set. Every field optional — an unset knob keeps
 *  whatever the workflow's author saved, which is a deliberate default and
 *  not a blank. */
export interface ComfyParams {
  positive?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  width?: number
  height?: number
  batch?: number
  checkpoint?: string
  image?: string
}

export const COMFY_WORKFLOW_KIND = 'comfy-workflow@1'

/** A workflow as it is stored: the graph, its seams, and a name for it.
 *  Content — sig-named in the `comfy:workflows` pool, shareable as-is. */
export interface ComfyWorkflowSpec {
  kind: typeof COMFY_WORKFLOW_KIND
  /** Stable slug the participant types: `/comfy.workflow.portrait`. */
  id: string
  label: string
  description?: string
  graph: ComfyGraph
  seams: ComfySeams
}

// ── reading the graph ───────────────────────────────────────────────────────

/** Is this input a link to another node's output? */
const isLink = (value: unknown): value is [string, number] =>
  Array.isArray(value) && value.length >= 1 && (typeof value[0] === 'string' || typeof value[0] === 'number')

const linkTarget = (value: unknown): string | null =>
  isLink(value) ? String(value[0]) : null

const isGraph = (value: unknown): value is ComfyGraph => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const nodes = Object.values(value as Record<string, unknown>)
  if (nodes.length === 0) return false
  return nodes.every(node =>
    !!node && typeof node === 'object'
    && typeof (node as ComfyNode).class_type === 'string'
    && !!(node as ComfyNode).inputs && typeof (node as ComfyNode).inputs === 'object')
}

/**
 * Walk UP from `start` looking for the first node that carries `input` as a
 * literal. Breadth-first over every link the visited nodes hold, so a chain
 * of conditioning nodes between an encoder and the sampler costs nothing.
 *
 * Bounded by the node count: a graph with a cycle (ComfyUI does not make one,
 * but a hand-edited file can) terminates instead of hanging the tab.
 */
const findUpstream = (
  graph: ComfyGraph,
  start: string | null,
  input: string,
  accept: (value: unknown) => boolean,
): ComfySeam | undefined => {
  if (!start) return undefined
  const seen = new Set<string>()
  const queue: string[] = [start]
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = graph[id]
    if (!node) continue
    const value = node.inputs[input]
    if (value !== undefined && !isLink(value) && accept(value)) return { node: id, input }
    for (const candidate of Object.values(node.inputs)) {
      const next = linkTarget(candidate)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return undefined
}

const isText = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Every node whose class name contains `needle`, in graph order. */
const nodesLike = (graph: ComfyGraph, needle: string): string[] =>
  Object.keys(graph).filter(id => graph[id]?.class_type?.toLowerCase().includes(needle))

/** A node's own literal input, when it has one under any of these names. */
const ownSeam = (
  graph: ComfyGraph,
  node: string | null,
  names: readonly string[],
  accept: (value: unknown) => boolean,
): ComfySeam | undefined => {
  if (!node) return undefined
  const held = graph[node]
  if (!held) return undefined
  for (const input of names) {
    const value = held.inputs[input]
    if (value !== undefined && !isLink(value) && accept(value)) return { node, input }
  }
  return undefined
}

/** The first node in the graph carrying one of these literal inputs. */
const anySeam = (
  graph: ComfyGraph,
  names: readonly string[],
  accept: (value: unknown) => boolean,
  skip: ReadonlySet<string> = new Set<string>(),
): ComfySeam | undefined => {
  for (const id of Object.keys(graph)) {
    if (skip.has(id)) continue
    const seam = ownSeam(graph, id, names, accept)
    if (seam) return seam
  }
  return undefined
}

/**
 * THE SAMPLER IS THE SPINE. Everything a person wants to change is one link
 * away from it: the two prompts, the seed, the latent that carries the size.
 * A graph with several (a refiner pass, a two-stage upscale) is answered with
 * the LAST one, because that is the one whose settings the eye sees — an
 * upscale pass's steps are the ones that finish the picture.
 */
const samplerNode = (graph: ComfyGraph): string | null => {
  const samplers = Object.keys(graph).filter(id => {
    const type = graph[id]?.class_type?.toLowerCase() ?? ''
    return type.includes('ksampler') || type === 'samplercustom' || type === 'samplercustomadvanced'
  })
  return samplers.length ? (samplers[samplers.length - 1] as string) : null
}

/**
 * WHICH NODE MAKES THE PICTURES. SaveImage writes files ComfyUI's `/view`
 * will serve; PreviewImage writes them to the temp folder and serves them
 * just the same. Either is a legitimate output, and a workflow with both
 * means the save is the keeper — so SaveImage wins.
 */
const outputNode = (graph: ComfyGraph): string | null => {
  const saves = nodesLike(graph, 'saveimage')
  if (saves.length) return saves[saves.length - 1] as string
  const previews = nodesLike(graph, 'previewimage')
  if (previews.length) return previews[previews.length - 1] as string
  // A workflow that ends in something this file has never heard of still has
  // an end: the node nothing else links to. Not a guess about class names —
  // a fact about the graph.
  const linked = new Set<string>()
  for (const node of Object.values(graph)) {
    for (const value of Object.values(node.inputs)) {
      const target = linkTarget(value)
      if (target) linked.add(target)
    }
  }
  const terminal = Object.keys(graph).filter(id => !linked.has(id))
  return terminal.length ? (terminal[terminal.length - 1] as string) : null
}

/**
 * Read a graph's seams. Never throws: an unrecognisable graph yields empty
 * seams, and a workflow with no seams still RUNS — it simply runs exactly as
 * its author saved it, which is a perfectly good thing for a workflow to do.
 */
export const inferSeams = (graph: ComfyGraph): ComfySeams => {
  const seams: ComfySeams = {}
  if (!isGraph(graph)) return seams

  const sampler = samplerNode(graph)
  const samplerInputs = sampler ? graph[sampler]?.inputs ?? {} : {}

  // The two prompts, by following the sampler's own words for them.
  const positive = findUpstream(graph, linkTarget(samplerInputs['positive']), 'text', isText)
  const negative = findUpstream(graph, linkTarget(samplerInputs['negative']), 'text', isText)
  if (positive) seams.positive = positive
  // A workflow can wire one encoder into both slots. Offering that node as
  // "negative" would let a participant overwrite their own prompt with the
  // word "blurry", so the second seam only exists when it is a second node.
  if (negative && negative.node !== positive?.node) seams.negative = negative

  // No sampler, or a sampler with no text upstream: fall back to text nodes in
  // graph order. Two of them read as positive-then-negative, which is the
  // order the ComfyUI default template writes and the only signal left.
  if (!seams.positive) {
    const first = anySeam(graph, ['text'], isText)
    if (first) {
      seams.positive = first
      const second = anySeam(graph, ['text'], isText, new Set<string>([first.node]))
      if (second) seams.negative = second
    }
  }

  // The sampler's own numbers. KSamplerAdvanced spells the seed `noise_seed`;
  // SamplerCustom keeps it on a separate RandomNoise node.
  seams.seed = ownSeam(graph, sampler, ['seed', 'noise_seed'], isNumber)
    ?? anySeam(graph, ['noise_seed', 'seed'], isNumber)
  seams.steps = ownSeam(graph, sampler, ['steps'], isNumber) ?? anySeam(graph, ['steps'], isNumber)
  seams.cfg = ownSeam(graph, sampler, ['cfg'], isNumber) ?? anySeam(graph, ['cfg'], isNumber)
  seams.sampler = ownSeam(graph, sampler, ['sampler_name'], isText) ?? anySeam(graph, ['sampler_name'], isText)
  seams.scheduler = ownSeam(graph, sampler, ['scheduler'], isText) ?? anySeam(graph, ['scheduler'], isText)

  // The size lives on whatever made the latent — Empty*LatentImage for a
  // text-to-image workflow, an upscale node for a second pass.
  const latent = linkTarget(samplerInputs['latent_image']) ?? linkTarget(samplerInputs['latent'])
  seams.width = findUpstream(graph, latent, 'width', isNumber) ?? anySeam(graph, ['width'], isNumber)
  seams.height = findUpstream(graph, latent, 'height', isNumber) ?? anySeam(graph, ['height'], isNumber)
  seams.batch = findUpstream(graph, latent, 'batch_size', isNumber) ?? anySeam(graph, ['batch_size'], isNumber)

  seams.checkpoint = anySeam(graph, ['ckpt_name', 'unet_name', 'model_name'], isText)
  seams.image = anySeam(graph, ['image'], isText)

  // Drop the undefined keys so the object says only what it found. A surface
  // asking `seams.negative` must get absence, not a key holding undefined.
  for (const key of Object.keys(seams) as (keyof ComfySeams)[]) {
    if (seams[key] === undefined) delete seams[key]
  }

  const output = outputNode(graph)
  if (output) seams.output = { node: output }
  return seams
}

// ── parsing ─────────────────────────────────────────────────────────────────

/** A slug that can be typed after a dot. */
export const workflowSlug = (input: string): string =>
  String(input ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

/**
 * Accept EITHER a bare ComfyUI API graph or a `comfy-workflow@1` spec, and
 * answer with a spec. The bare graph is the important half: what ComfyUI's
 * "Save (API Format)" puts on disk is a graph, so pasting THAT is the
 * gesture, and anything that demanded a wrapper first would be asking the
 * participant to hand-edit JSON to use their own workflow.
 *
 * Throws with a readable reason rather than half-succeeding — a workflow that
 * cannot be understood must not be saved, or the roster fills with rows that
 * fail at generate time.
 */
export const parseComfyWorkflow = (input: unknown, fallbackLabel = 'workflow'): ComfyWorkflowSpec => {
  let raw: unknown = input
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { throw new Error('not JSON') }
  }
  if (!raw || typeof raw !== 'object') throw new Error('not an object')

  const held = raw as Record<string, unknown>

  // The editor's own save (not API format) wraps the graph in `{ nodes: [...] }`
  // with link ids — a different shape entirely, and one ComfyUI's /prompt does
  // not accept. Saying so is worth more than "invalid workflow".
  if (Array.isArray(held['nodes']) && held['links'] !== undefined) {
    throw new Error('this is an editor save — use ComfyUI’s "Save (API Format)" instead')
  }

  const wrapped = held['kind'] === COMFY_WORKFLOW_KIND || isGraph(held['graph'])
  const graph = (wrapped ? held['graph'] : held) as unknown

  if (!isGraph(graph)) throw new Error('no ComfyUI nodes found')

  const label = String((wrapped ? held['label'] : '') || fallbackLabel).trim() || 'workflow'
  const id = workflowSlug(String((wrapped ? held['id'] : '') || label)) || 'workflow'

  // DECLARATION BEATS INFERENCE. A spec that names its own seams is an author
  // saying "this is the knob I meant"; inference only fills what was left out,
  // so a workflow can override one seam without restating the other nine.
  const declared = (wrapped ? held['seams'] : undefined) as ComfySeams | undefined
  const seams: ComfySeams = { ...inferSeams(graph), ...(declared && typeof declared === 'object' ? declared : {}) }

  const description = wrapped && typeof held['description'] === 'string' ? held['description'] : undefined

  return { kind: COMFY_WORKFLOW_KIND, id, label, ...(description ? { description } : {}), graph, seams }
}

// ── writing values in ───────────────────────────────────────────────────────

/** A fresh seed. ComfyUI takes any non-negative integer; staying inside
 *  JS's safe range keeps the number that comes back out of `/history`
 *  identical to the one sent, which is what makes a re-roll reproducible. */
export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 48)

const clone = (graph: ComfyGraph): ComfyGraph =>
  typeof structuredClone === 'function'
    ? structuredClone(graph)
    : JSON.parse(JSON.stringify(graph)) as ComfyGraph

/**
 * A copy of the graph with the caller's values written at the seams.
 *
 * NEVER MUTATES THE SPEC. The workflow is content — the same bytes back a
 * signature, and a run that edited its own graph in place would change what a
 * saved workflow IS every time somebody typed a prompt.
 *
 * An unset param leaves the author's saved value; a param with no seam is
 * dropped silently, because the alternative (throwing) would make a workflow
 * without a negative prompt refuse to run for a caller that always sends one.
 */
export const applyParams = (
  graph: ComfyGraph,
  seams: ComfySeams,
  params: ComfyParams,
): ComfyGraph => {
  const out = clone(graph)
  const write = (seam: ComfySeam | undefined, value: unknown): void => {
    if (!seam || value === undefined || value === null || value === '') return
    const node = out[seam.node]
    if (!node) return
    node.inputs[seam.input] = value
  }
  write(seams.positive, params.positive)
  write(seams.negative, params.negative)
  write(seams.seed, params.seed)
  write(seams.steps, params.steps)
  write(seams.cfg, params.cfg)
  write(seams.sampler, params.sampler)
  write(seams.scheduler, params.scheduler)
  write(seams.width, params.width)
  write(seams.height, params.height)
  write(seams.batch, params.batch)
  write(seams.checkpoint, params.checkpoint)
  write(seams.image, params.image)
  return out
}

/** What a workflow's seams currently hold — the window's initial field
 *  values, so a participant sees the author's settings rather than blanks. */
export const readParams = (graph: ComfyGraph, seams: ComfySeams): ComfyParams => {
  const read = <T,>(seam: ComfySeam | undefined): T | undefined => {
    if (!seam) return undefined
    const value = graph[seam.node]?.inputs?.[seam.input]
    return isLink(value) ? undefined : value as T
  }
  const params: ComfyParams = {}
  const positive = read<string>(seams.positive); if (positive !== undefined) params.positive = positive
  const negative = read<string>(seams.negative); if (negative !== undefined) params.negative = negative
  const seed = read<number>(seams.seed); if (seed !== undefined) params.seed = seed
  const steps = read<number>(seams.steps); if (steps !== undefined) params.steps = steps
  const cfg = read<number>(seams.cfg); if (cfg !== undefined) params.cfg = cfg
  const sampler = read<string>(seams.sampler); if (sampler !== undefined) params.sampler = sampler
  const scheduler = read<string>(seams.scheduler); if (scheduler !== undefined) params.scheduler = scheduler
  const width = read<number>(seams.width); if (width !== undefined) params.width = width
  const height = read<number>(seams.height); if (height !== undefined) params.height = height
  const batch = read<number>(seams.batch); if (batch !== undefined) params.batch = batch
  const checkpoint = read<string>(seams.checkpoint); if (checkpoint !== undefined) params.checkpoint = checkpoint
  return params
}

/** The knobs this workflow actually offers, for a surface that renders one
 *  control per seam instead of a fixed form. */
export const offeredKnobs = (seams: ComfySeams): readonly (keyof ComfySeams)[] =>
  (['positive', 'negative', 'seed', 'steps', 'cfg', 'width', 'height', 'batch', 'checkpoint'] as const)
    .filter(knob => seams[knob] !== undefined)
