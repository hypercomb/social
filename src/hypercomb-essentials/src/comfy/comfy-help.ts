// comfy/comfy-help.ts
//
// FROM THE TILE. A selected tile's picture and its properties help the
// prompt. Several reviewers each write one option. Jev picks one. The
// participant's own words stay in the prompt that runs.
//
// This file is pure aside from `pictureContext`, which only reads a blob
// the caller already holds. It does not fetch, and it does not know which
// model answers.

export const COMFY_REVIEWER_DEFAULT = 3
export const COMFY_REVIEWER_MAX = 8

/** One to eight. Anything else becomes the default. */
export const clampReviewers = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return COMFY_REVIEWER_DEFAULT
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return COMFY_REVIEWER_DEFAULT
  return Math.min(COMFY_REVIEWER_MAX, Math.max(1, Math.round(n)))
}

const SIG = /^[0-9a-f]{64}$/i
const PICTURE_KEYS = new Set(['small', 'large', 'flat', 'imageSig', 'point'])

const briefValue = (value: unknown, depth: number): string => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || SIG.test(text) || text.length > 240) return ''
    return text
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) {
    return value.map(item => briefValue(item, depth + 1)).filter(Boolean).slice(0, 12).join(', ')
  }
  if (!value || typeof value !== 'object' || depth >= 2) return ''
  const lines: string[] = []
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (PICTURE_KEYS.has(key)) continue
    const shown = briefValue(inner, depth + 1)
    if (shown) lines.push(`${key}: ${shown}`)
  }
  return lines.join('; ')
}

/** The tile, in words a reviewer can read. Picture bytes are not in here.
 *  A separate reading of those bytes is, when the caller has one. */
export const tileBriefText = (name: string, props: unknown, picture = ''): string => {
  const lines = [`Tile: ${String(name ?? '').trim()}`]
  if (picture.trim()) lines.push(picture.trim())
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (PICTURE_KEYS.has(key)) continue
      const shown = briefValue(value, 0)
      if (shown) lines.push(`${key}: ${shown}`)
    }
  }
  return lines.join('\n').slice(0, 2_000)
}

/** What the pixels are, without sending them. Width and height are the
 *  picture's own, not the sample grid. */
export const pictureReading = (width: number, height: number, rgba: ArrayLike<number>): string => {
  if (width < 1 || height < 1 || rgba.length < 4) return ''
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 64)))
  let count = 0
  let lum = 0
  const buckets = new Map<string, number>()
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4
      if (i + 3 >= rgba.length) continue
      const alpha = rgba[i + 3] ?? 0
      if (alpha < 16) continue
      const r = rgba[i] ?? 0
      const g = rgba[i + 1] ?? 0
      const b = rgba[i + 2] ?? 0
      count += 1
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      const key = `${r >> 5},${g >> 5},${b >> 5}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
  }
  if (!count) return `Picture: ${width} by ${height}.`
  const tone = lum / count < 90 ? 'dark' : lum / count > 170 ? 'light' : 'mid'
  let best = ''
  let bestN = -1
  for (const [key, n] of buckets) {
    if (n > bestN) { best = key; bestN = n }
  }
  const [br, bg, bb] = best.split(',').map(part => Math.min(255, (Number(part) << 5) + 16))
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `Picture: ${width} by ${height}, ${tone}, mostly #${hex(br ?? 0)}${hex(bg ?? 0)}${hex(bb ?? 0)}.`
}

export const REVIEWER_SYSTEM = 'You write one prompt for a picture model. Answer with the prompt only, as one paragraph. No title, no list, no apology.'

/** Eight ways to read the same tile. The count the participant sets is how
 *  many of these run, in this order. */
export const REVIEWER_STANCES = [
  'Stay close to the picture. Change only what the participant\'s words require.',
  'Let the properties name the subject. Let the picture set the light and the palette.',
  'Keep the participant\'s own words exact, and add only what the picture and the properties make necessary.',
  'Keep the subject. Push the picture\'s palette and light into a richer illustration.',
  'Treat it as a background: atmosphere, no lettering, no extra characters.',
  'Treat it as an emblem: one clear subject, centered, simple surroundings.',
  'When the properties and the picture disagree, follow the properties.',
  'Offer a bolder hour or weather. The subject stays the tile\'s subject.',
] as const

export interface ReviewerAsk {
  readonly stance: string
  readonly content: string
}

export const reviewerAsks = (count: number, brief: string, own: string): ReviewerAsk[] => {
  const words = own.trim()
  return REVIEWER_STANCES.slice(0, clampReviewers(count)).map(stance => ({
    stance,
    content: [
      `Stance: ${stance}`,
      brief,
      `The participant wrote:\n${words || '(nothing)'}`,
      'Write the picture prompt. When they wrote something, keep those words in it.',
    ].join('\n\n'),
  }))
}

/** The model's paragraph, with the wrapping taken off. */
export const parsePromptOption = (raw: string): string => {
  const stripped = String(raw ?? '').replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
  const text = stripped.split(/\n+/).map(line => line.trim()).filter(Boolean).join(' ')
    .replace(/^(prompt|option)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
  return text.slice(0, 600)
}

/** Their words are part of the prompt. A prompt that already contains them
 *  is left as the reviewer wrote it. */
export const withOwnWords = (prompt: string, own: string): string => {
  const words = own.trim()
  const body = prompt.trim()
  if (!words) return body
  if (!body) return words
  if (body.toLowerCase().includes(words.toLowerCase())) return body
  return `${body}\n${words}`
}

/** `picked` is an option index. -1 means Jev was not there: use the first
 *  option. -2 means Jev declined: use the participant's own words. */
export const promptFromChoice = (own: string, options: readonly string[], picked: number): string => {
  if (picked === -2) return own.trim() || options[0]?.trim() || ''
  const chosen = picked >= 0 && picked < options.length
    ? options[picked]?.trim() ?? ''
    : options[0]?.trim() ?? ''
  if (chosen) return withOwnWords(chosen, own)
  return own.trim()
}

export async function helpedPrompt(args: {
  own: string
  brief: string
  reviewers: number
  propose: (ask: ReviewerAsk) => Promise<string>
  choose: (options: readonly string[]) => Promise<number>
  stopped?: () => boolean
}): Promise<string> {
  const asks = reviewerAsks(args.reviewers, args.brief, args.own)
  const settled = await Promise.all(asks.map(async ask => {
    try { return parsePromptOption(await args.propose(ask)) } catch { return '' }
  }))
  if (args.stopped?.()) return args.own.trim()
  const options: string[] = []
  for (const option of settled) {
    if (!option) continue
    if (options.some(held => held.toLowerCase() === option.toLowerCase())) continue
    options.push(option)
  }
  let picked = -1
  if (options.length && !args.stopped?.()) {
    try { picked = await args.choose(options) } catch { picked = -1 }
  }
  if (args.stopped?.()) return args.own.trim()
  return promptFromChoice(args.own, options, picked)
}

type Drawable = OffscreenCanvas | HTMLCanvasElement

const canvas2d = (width: number, height: number): { canvas: Drawable; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null => {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    return ctx ? { canvas, ctx } : null
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return ctx ? { canvas, ctx } : null
}

const jpegBase64 = async (canvas: Drawable): Promise<string> => {
  let blob: Blob | null = null
  if ('convertToBlob' in canvas) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
  else blob = await new Promise(resolve => (canvas as HTMLCanvasElement).toBlob(b => resolve(b), 'image/jpeg', 0.7))
  if (!blob || typeof btoa !== 'function') return ''
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000))
  }
  return btoa(binary)
}

/** A short reading of the picture, and a small JPEG a vision model can see.
 *  A blob that is not a picture yields neither. */
export async function pictureContext(blob: Blob): Promise<{ reading: string; image?: { mime: string; base64: string } }> {
  if (typeof createImageBitmap !== 'function') return { reading: '' }
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height, 1))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const drawn = canvas2d(width, height)
      if (!drawn) return { reading: '' }
      drawn.ctx.drawImage(bitmap, 0, 0, width, height)
      const data = drawn.ctx.getImageData(0, 0, width, height).data
      const reading = pictureReading(bitmap.width, bitmap.height, data)
      const base64 = await jpegBase64(drawn.canvas)
      const image = base64 && base64.length < 300_000 ? { mime: 'image/jpeg', base64 } : undefined
      return image ? { reading, image } : { reading }
    } finally {
      bitmap.close?.()
    }
  } catch {
    return { reading: '' }
  }
}
