// presentation/tiles/pixi3d-no-eval.spec.ts
//
// The bridge is index arithmetic over three lists that live in three
// packages, so each claim is checked against the real thing where it can be:
// the parsers `@pixi/3d` actually ships, the tables Pixi's no-eval polyfill
// actually keeps, and the names the two vendor builds actually export.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NO_EVAL_UBO_TABLE, NO_EVAL_UNIFORM_TABLE, bridgeNoEvalParsers, bridgeNoEvalPixi,
  type UboSyncFunction, type UniformParserLike, type UniformSyncFunction,
} from './pixi3d-no-eval.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../../..')
/** Neither package exports its `package.json`, so the folder is found on disk:
 *  the workspace's own install first, then the hoisted one. */
const packageDir = (name: string): string => {
  const found = [resolve(src, 'hypercomb-essentials/node_modules', name), resolve(src, 'node_modules', name)].find(dir => existsSync(dir))
  if (!found) throw new Error(`${name} is not installed`)
  return found
}

/** `@pixi/3d`'s own parsers, taken by running its `addUniformParsers` against
 *  a list we hold — the module's only import is Pixi's `uniformParsers`. */
const shippedParsers = (): UniformParserLike[] => {
  const file = resolve(packageDir('@pixi/3d'), 'dist/utils/addUniformParsers.mjs')
  const body = readFileSync(file, 'utf8')
    .replace(/^import .*$/m, '')
    .replace(/^export .*$/m, '')
    .replace(/^\/\/# sourceMappingURL.*$/m, '')
  const uniformParsers: UniformParserLike[] = []
  new Function('uniformParsers', `${body}\naddUniformParsers()`)(uniformParsers)
  return uniformParsers
}

const builtIn = (count: number): UniformParserLike[] =>
  Array.from({ length: count }, () => ({ type: 'built-in', test: () => false }))

const tables = (count: number): { uniform: UniformSyncFunction[]; ubo: UboSyncFunction[] } => ({
  uniform: Array.from({ length: count }, () => () => undefined),
  ubo: Array.from({ length: count }, () => () => undefined),
})

describe('the parsers @pixi/3d ships', () => {
  it('are the four the bridge knows, and every one is recognised', () => {
    const shipped = shippedParsers()
    expect(shipped.map(parser => parser.type)).toEqual(['mat4x4<f32>', 'mat3x3<f32>', 'vec3<f32>', 'vec3<f32>'])
    const { uniform, ubo } = tables(3)
    expect(bridgeNoEvalParsers([...builtIn(3), ...shipped], uniform, ubo)).toBe('bridged')
    expect(uniform).toHaveLength(7)
    expect(ubo).toHaveLength(7)
  })

  it('write the same numbers as the code strings they replace', () => {
    const shipped = shippedParsers() as (UniformParserLike & { uniform: string; ubo: string })[]
    const { uniform, ubo } = tables(0)
    expect(bridgeNoEvalParsers(shipped, uniform, ubo)).toBe('bridged')
    const values = [
      { elements: Array.from({ length: 16 }, (_, i) => i + 1) },
      { elements: Array.from({ length: 9 }, (_, i) => i + 1) },
      { x: 2, y: 3, z: 5 },
      { r: 0.25, g: 0.5, b: 0.75 },
    ]
    shipped.forEach((parser, j) => {
      const uv = { u: values[j] } as never
      // The uniform buffer: the string, run as Pixi would, against the function.
      const fromString = new Array<number>(16).fill(-1)
      new Function('name', 'data', 'offset', 'uv', 'v', parser.ubo)('u', fromString, 2, uv, undefined)
      const fromFunction = new Array<number>(16).fill(-1)
      ubo[j]!('u', fromFunction, 2, uv, undefined)
      expect(fromFunction).toEqual(fromString)
      // The plain uniform: the same call reaches gl with the same arguments.
      const calls = (run: (gl: never, ud: never) => void): unknown[] => {
        const seen: unknown[] = []
        const gl = new Proxy({}, { get: (_t, method) => (...args: unknown[]) => { seen.push([method, ...args]) } })
        run(gl as never, { u: { location: 'loc', value: [9, 9, 9] } } as never)
        return seen
      }
      const viaString = calls((gl, ud) => {
        new Function('name', 'cu', 'cv', 'v', 'ud', 'uv', 'gl', parser.uniform)('u', undefined, undefined, undefined, ud, uv, gl)
      })
      const viaFunction = calls((gl, ud) => uniform[j]!('u', undefined, undefined, undefined, ud, uv, gl))
      expect(viaFunction).toEqual(viaString)
      expect(viaFunction).toHaveLength(1)
    })
  })
})

describe('the bridge', () => {
  it('does nothing for a Pixi that evals — it has no tables', () => {
    expect(bridgeNoEvalParsers(shippedParsers(), undefined, undefined)).toBe('not-needed')
    expect(bridgeNoEvalPixi({ uniformParsers: shippedParsers() })).toBe('not-needed')
  })

  it('finds the tables under the names the vendor builds export', () => {
    const shipped = shippedParsers()
    const { uniform, ubo } = tables(0)
    expect(bridgeNoEvalPixi({ uniformParsers: shipped, [NO_EVAL_UNIFORM_TABLE]: uniform, [NO_EVAL_UBO_TABLE]: ubo })).toBe('bridged')
    expect(uniform).toHaveLength(4)
  })

  it('is safe to run twice', () => {
    const parsers = [...builtIn(2), ...shippedParsers()]
    const { uniform, ubo } = tables(2)
    expect(bridgeNoEvalParsers(parsers, uniform, ubo)).toBe('bridged')
    const first = [...uniform]
    expect(bridgeNoEvalParsers(parsers, uniform, ubo)).toBe('bridged')
    expect(uniform).toEqual(first)
  })

  it('refuses a parser it does not know, and fills nothing', () => {
    const stranger: UniformParserLike = { type: 'vec2<f32>', test: () => true }
    const { uniform, ubo } = tables(1)
    expect(bridgeNoEvalParsers([...builtIn(1), ...shippedParsers(), stranger], uniform, ubo)).toBe('unknown-parser')
    expect(uniform).toHaveLength(1)
    expect(ubo).toHaveLength(1)
  })

  it('refuses tables that are not index for index', () => {
    const { uniform } = tables(2)
    expect(bridgeNoEvalParsers([...builtIn(2), ...shippedParsers()], uniform, tables(3).ubo)).toBe('unknown-parser')
  })
})

describe('the three places that must agree', () => {
  it("Pixi's no-eval polyfill still keeps one function per built-in parser, by index", () => {
    const pixi = packageDir('pixi.js')
    const count = (file: string, name: string): number => {
      const text = readFileSync(resolve(pixi, file), 'utf8')
      const start = text.indexOf(`const ${name} = [`)
      expect(start, `${name} is declared in ${file}`).toBeGreaterThan(-1)
      const end = text.indexOf('\n];', start)
      return text.slice(start, end).split('\n').filter(line => /^ {2}\(/.test(line)).length
    }
    const parsers = readFileSync(resolve(pixi, 'lib/rendering/renderers/shared/shader/utils/uniformParsers.mjs'), 'utf8')
    const builtInParsers = parsers.split('\n').filter(line => /^ {4}type: /.test(line)).length
    expect(builtInParsers).toBeGreaterThan(0)
    expect(count('lib/unsafe-eval/uniforms/uniformSyncFunctions.mjs', 'uniformParserFunctions')).toBe(builtInParsers)
    expect(count('lib/unsafe-eval/ubo/uboSyncFunctions.mjs', 'uboParserFunctions')).toBe(builtInParsers)
    // …and looks a parser's function up by its index in the list.
    const polyfill = readFileSync(resolve(pixi, 'lib/unsafe-eval/uniforms/generateUniformsSyncPolyfill.mjs'), 'utf8')
    expect(polyfill).toContain('uniformParserFunctions[j]')
  })

  it('both vendor builds export the tables under the names the bridge reads', () => {
    for (const script of ['hypercomb-web/scripts/build-pixi-vendor.ts', 'hypercomb-shim/scripts/build-vendor.mjs']) {
      const text = readFileSync(resolve(src, script), 'utf8')
      expect(text, script).toContain(`uniformParserFunctions as ${NO_EVAL_UNIFORM_TABLE}`)
      expect(text, script).toContain(`uboParserFunctions as ${NO_EVAL_UBO_TABLE}`)
    }
  })
})
