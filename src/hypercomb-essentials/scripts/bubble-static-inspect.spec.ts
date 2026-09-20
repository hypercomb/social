import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const inspector = join(directory, 'bubble-static-inspect.py')
const python = process.env['PYTHON'] ?? (process.platform === 'win32' ? 'py' : 'python3')
const pythonPrefix = process.env['PYTHON'] || process.platform !== 'win32' ? [] : ['-3']
let fixtureDirectory: string

beforeEach(() => { fixtureDirectory = mkdtempSync(join(tmpdir(), 'bubble-static-inspect-')) })
afterEach(() => { rmSync(fixtureDirectory, { recursive: true, force: true }) })

function fixture(name: string, bytes: Uint8Array): string {
  const path = join(fixtureDirectory, name)
  writeFileSync(path, bytes)
  return path
}

function inspect(image: string, ...args: string[]) {
  const result = spawnSync(python, [...pythonPrefix, inspector, '--image', image, ...args], {
    encoding: 'utf8', shell: false,
  })
  expect(result.error).toBeUndefined()
  return result
}

function helper(code: string) {
  const result = spawnSync(python, [...pythonPrefix, '-c', code], { encoding: 'utf8', shell: false })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return result.stdout.trim()
}

describe('bubble-static-inspect', () => {
  it('annotates only one-operand direct near targets, never a far transfer operand', () => {
    const escaped = inspector.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
    const output = helper([
      'import runpy',
      'from types import SimpleNamespace as N',
      `module = runpy.run_path('${escaped}')`,
      'target = module["direct_near_target"]',
      'print(target([N(type=7, imm=0x10001)], 7))',
      'print(target([N(type=7, imm=0x1234), N(type=7, imm=0x5678)], 7))',
      'print(target([N(type=8, imm=0x1234)], 7))',
    ].join('; '))

    expect(output.split(/\r?\n/)).toEqual(['1', 'None', 'None'])
  })

  it('refuses a wrong-sized image without modifying it', () => {
    const image = fixture('short.bin', Uint8Array.of(1, 2, 3))
    const before = readFileSync(image)
    const result = inspect(image)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('image size 3 does not equal expected 131856')
    expect(result.stdout).toBe('')
    expect(readFileSync(image)).toEqual(before)
  })

  it('refuses a same-sized image with the wrong hash without modifying it', () => {
    const image = fixture('wrong-hash.bin', new Uint8Array(131_856))
    const before = readFileSync(image)
    const result = inspect(image, '--start', '0', '--length', '16')

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('image SHA-256 does not match')
    expect(result.stdout).toBe('')
    expect(readFileSync(image)).toEqual(before)
  })

  it.each([
    ['--start=-1', '--start must be non-negative'],
    ['--start=131856', 'lies outside'],
    ['--length=0', '--length must be positive'],
    ['--length=4097', '--length must not exceed 4096'],
  ])('rejects invalid range %s before reading or inspecting a supplied image', (argument, error) => {
    const image = fixture('range.bin', Uint8Array.of(4, 5, 6))
    const before = readFileSync(image)
    const result = inspect(image, argument)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(error)
    expect(result.stdout).toBe('')
    expect(readFileSync(image)).toEqual(before)
  })
})
