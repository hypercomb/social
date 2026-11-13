// presentation/tiles/pixi3d-no-eval.ts
//
// PIXI'S 3D ON A PIXI THAT MAY NOT EVAL.
//
// The web shell and every published host run the `pixi.js/unsafe-eval` build
// of Pixi: their content security policy has no 'unsafe-eval', so Pixi's
// generated uniform-sync code (`new Function`) is swapped for a static
// polyfill. That polyfill does not read a uniform parser's code strings. It
// keeps one FUNCTION per parser in two private tables, and finds a parser's
// function by the parser's INDEX in `uniformParsers`.
//
// `@pixi/3d` 0.1.0 pushes four parsers of its own, as code strings only. On
// the no-eval build their indices run past the end of the tables, the lookup
// returns `undefined`, and the first 3D draw throws
// `functionMap[i] is not a function`. This file is the missing half: the same
// four parsers written as functions, appended to the tables at the indices
// the parsers hold.
//
// The tables are private to Pixi, so the vendor builds (hypercomb-web
// `build-pixi-vendor.ts`, hypercomb-shim `build-vendor.mjs`) export them from
// the runtime bundle under the two names below. A Pixi that evals (the dev
// shell) exports neither, and needs nothing.
//
// Pure: it is handed the parser list and the tables, and touches nothing else.
// A parser it does not recognise is refused, never guessed at — the caller
// then declines to draw rather than crash a frame.

/** The names the vendor builds export the polyfill's tables under. */
export const NO_EVAL_UNIFORM_TABLE = '__noEvalUniformParserFunctions'
export const NO_EVAL_UBO_TABLE = '__noEvalUboParserFunctions'

/** A uniform parser as Pixi lists it: only what this file reads. */
export interface UniformParserLike {
  readonly type: string
  readonly test: (data: never) => boolean
}

type UniformData = Record<string, { location: unknown; value: number[] }>
type UniformValues = Record<string, never>
type Gl = {
  uniformMatrix4fv(location: unknown, transpose: boolean, value: unknown): void
  uniformMatrix3fv(location: unknown, transpose: boolean, value: unknown): void
  uniform3f(location: unknown, x: number, y: number, z: number): void
}

/** Pixi's polyfill calls a uniform function as `(name, cu, cv, v, ud, uv, gl)`. */
export type UniformSyncFunction = (
  name: string, cu: unknown, cv: unknown, v: unknown, ud: UniformData, uv: UniformValues, gl: Gl,
) => void
/** …and a uniform-buffer function as `(name, data, offset, uv, v)`. */
export type UboSyncFunction = (
  name: string, data: Float32Array | number[], offset: number, uv: UniformValues, v: unknown,
) => void

type Bridged = { readonly uniform: UniformSyncFunction; readonly ubo: UboSyncFunction }

const elementsOf = (uv: UniformValues, name: string): ArrayLike<number> =>
  (uv[name] as unknown as { elements: ArrayLike<number> }).elements

/** A three-part value read by three named fields (`x y z`, or `r g b`). */
const triple = (a: string, b: string, c: string): Bridged => ({
  uniform: (name, _cu, _cv, _v, ud, uv, gl) => {
    const cv = ud[name]!.value
    const v = uv[name] as unknown as Record<string, number>
    if (cv[0] !== v[a] || cv[1] !== v[b] || cv[2] !== v[c]) {
      cv[0] = v[a]!
      cv[1] = v[b]!
      cv[2] = v[c]!
      gl.uniform3f(ud[name]!.location, v[a]!, v[b]!, v[c]!)
    }
  },
  ubo: (name, data, offset, uv) => {
    const v = uv[name] as unknown as Record<string, number>
    data[offset] = v[a]!
    data[offset + 1] = v[b]!
    data[offset + 2] = v[c]!
  },
})

const MATRIX4: Bridged = {
  uniform: (name, _cu, _cv, _v, ud, uv, gl) => {
    gl.uniformMatrix4fv(ud[name]!.location, false, elementsOf(uv, name))
  },
  ubo: (name, data, offset, uv) => {
    const v = elementsOf(uv, name)
    for (let i = 0; i < 16; i++) data[offset + i] = v[i]!
  },
}

const MATRIX3: Bridged = {
  uniform: (name, _cu, _cv, _v, ud, uv, gl) => {
    gl.uniformMatrix3fv(ud[name]!.location, false, elementsOf(uv, name))
  },
  // A uniform buffer pads each column of a mat3 to four floats.
  ubo: (name, data, offset, uv) => {
    const v = elementsOf(uv, name)
    data[offset] = v[0]!
    data[offset + 1] = v[1]!
    data[offset + 2] = v[2]!
    data[offset + 4] = v[3]!
    data[offset + 5] = v[4]!
    data[offset + 6] = v[5]!
    data[offset + 8] = v[6]!
    data[offset + 9] = v[7]!
    data[offset + 10] = v[8]!
  },
}

const XYZ = triple('x', 'y', 'z')
const RGB = triple('r', 'g', 'b')

/** What each of `@pixi/3d`'s parsers accepts, as a value only it says yes to. */
const KNOWN: readonly { readonly type: string; readonly probe: unknown; readonly bridged: Bridged }[] = [
  { type: 'mat4x4<f32>', probe: { type: 'mat4x4<f32>', size: 1, value: { elements: new Array<number>(16).fill(0) } }, bridged: MATRIX4 },
  { type: 'mat3x3<f32>', probe: { type: 'mat3x3<f32>', size: 1, value: { elements: new Array<number>(9).fill(0) } }, bridged: MATRIX3 },
  { type: 'vec3<f32>', probe: { type: 'vec3<f32>', size: 1, value: { x: 0, y: 0, z: 0 } }, bridged: XYZ },
  { type: 'vec3<f32>', probe: { type: 'vec3<f32>', size: 1, value: { r: 0, g: 0, b: 0 } }, bridged: RGB },
]

const recognise = (parser: UniformParserLike): Bridged | null => {
  const matches = KNOWN.filter(known => {
    if (known.type !== parser.type) return false
    try { return parser.test(known.probe as never) === true } catch { return false }
  })
  return matches.length === 1 ? matches[0]!.bridged : null
}

export type NoEvalBridge =
  /** This Pixi evals: there are no tables, and nothing to do. */
  | 'not-needed'
  /** Every parser past the tables now has its function (or already had). */
  | 'bridged'
  /** A parser past the tables is not one this file knows: do not draw. */
  | 'unknown-parser'

/** Give every parser that stands past the end of the no-eval tables its
 *  function, at the parser's own index. Safe to call again: a table already
 *  as long as the parser list is left alone. */
export function bridgeNoEvalParsers(
  parsers: readonly UniformParserLike[],
  uniformTable: UniformSyncFunction[] | undefined,
  uboTable: UboSyncFunction[] | undefined,
): NoEvalBridge {
  if (!Array.isArray(uniformTable) || !Array.isArray(uboTable)) return 'not-needed'
  // The two tables are filled together, index for index with the parser list.
  if (uniformTable.length !== uboTable.length) return 'unknown-parser'
  const from = uniformTable.length
  if (from >= parsers.length) return 'bridged'
  const found: Bridged[] = []
  for (let j = from; j < parsers.length; j++) {
    const bridged = recognise(parsers[j]!)
    if (!bridged) return 'unknown-parser'
    found.push(bridged)
  }
  // All or nothing: a half-filled table would move the crash, not remove it.
  found.forEach((bridged, k) => {
    uniformTable[from + k] = bridged.uniform
    uboTable[from + k] = bridged.ubo
  })
  return 'bridged'
}

/** The bridge, for the Pixi this page actually loaded. */
export function bridgeNoEvalPixi(pixi: object): NoEvalBridge {
  const exports = pixi as Record<string, unknown>
  return bridgeNoEvalParsers(
    (exports['uniformParsers'] ?? []) as UniformParserLike[],
    exports[NO_EVAL_UNIFORM_TABLE] as UniformSyncFunction[] | undefined,
    exports[NO_EVAL_UBO_TABLE] as UboSyncFunction[] | undefined,
  )
}
