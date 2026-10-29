import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SignatureService } from './signature.service.js'
import { MINIFY_TRANSPILER_PROGRAM, minifyModuleBody, ownedMinifyTool, transpilerSignature } from './minify-transpiler.js'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'minify-transpiler.ts'), 'utf8')
const mark = '// program\n'
const program = source.slice(source.indexOf(mark) + mark.length, source.indexOf('\n// program end'))

describe('the minify transpiler', () => {
  it('is the program between the markers, and that text is its signature', async () => {
    expect(MINIFY_TRANSPILER_PROGRAM).toBe(program)
    const bytes = new TextEncoder().encode(program)
    const sig = await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(await transpilerSignature()).toBe(sig)
    expect((await ownedMinifyTool()).name).toBe(sig)
  })

  it('drops comments and spare spaces and keeps names', () => {
    expect(minifyModuleBody('export  const  Helper  =  class {   }  /* gone */\n')).toBe('export const Helper=class{}')
  })

  it('keeps a newline that separates tokens, and the spaces inside a string', () => {
    expect(minifyModuleBody('return\n1')).toBe('return\n1')
    expect(minifyModuleBody('export const label = "a  b"\n')).toBe('export const label="a  b"')
  })

  it('keeps a regex and a division', () => {
    expect(minifyModuleBody('export const re = /a b/g\nexport const div = a / b\n')).toBe('export const re=/a b/g\nexport const div=a/b')
  })

  it('keeps a template, including the expression inside it', () => {
    expect(minifyModuleBody('export const s = `a ${ 1 + 2 }`\n')).toBe('export const s=`a ${ 1 + 2 }`')
  })

  it('refuses a body it cannot read', () => {
    expect(() => minifyModuleBody('const café = 1')).toThrow(/does not read/)
    expect(() => minifyModuleBody('/* never closed')).toThrow(/open comment/)
  })
})
