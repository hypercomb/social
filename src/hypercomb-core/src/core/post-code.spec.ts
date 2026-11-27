// post-code.spec.ts — the one spelling of an entry pool's code
// (documentation/open-entry-pools.md): `#post=<O>~<nonce>`, exact, and the
// mark a visitor shell wears when it takes one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  POST_CODE_EFFECT,
  POST_CODE_PREFIX,
  POST_SHELL_MARK_CONTENT,
  POST_SHELL_MARK_NAME,
  isPostFragment,
  parsePostCode,
  postCodeFragment,
  shellTakesPostCode,
} from './post-code.js'
import { OPEN_ENTRY_KIND, nostrKindEntry } from './nostr-kinds.js'
import * as core from '../index.js'

const O = '3f'.repeat(32)
const NONCE = '0a'.repeat(16)
const CODE = `#post=${O}~${NONCE}`

describe('parsePostCode', () => {
  it('reads the two parts of an exact code', () => {
    expect(parsePostCode(CODE)).toEqual({ record: O, nonce: NONCE })
    expect(CODE.length - POST_CODE_PREFIX.length).toBe(97)
  })

  it('refuses anything that is nearly a code', () => {
    for (const fragment of [
      `post=${O}~${NONCE}`, // no #
      `#post=${O.toUpperCase()}~${NONCE}`, // capitals
      `#post=${O}~${NONCE.toUpperCase()}`,
      `#post=${O.slice(1)}~${NONCE}`, // short record
      `#post=${O}~${NONCE}0`, // long nonce
      `#post=${O}${NONCE}`, // no separator
      `#post=${O}-${NONCE}`,
      `#post=${O}~${NONCE}&x=1`, // anything after
      ` ${CODE}`, `${CODE} `,
      `#swarm=${O}~${NONCE}`,
      `#post=`, '', '#',
    ]) expect(parsePostCode(fragment), fragment).toBeNull()
    for (const value of [null, undefined, 42, { hash: CODE }]) expect(parsePostCode(value)).toBeNull()
  })

  it('isPostFragment asks the same question', () => {
    expect(isPostFragment(CODE)).toBe(true)
    expect(isPostFragment('#cheese')).toBe(false)
    expect(isPostFragment(`#post=${O}`)).toBe(false)
  })
})

describe('postCodeFragment', () => {
  it('writes a code that parses back to the same two parts', () => {
    expect(postCodeFragment(O, NONCE)).toBe(CODE)
    expect(parsePostCode(postCodeFragment(O, NONCE))).toEqual({ record: O, nonce: NONCE })
    expect(postCodeFragment(` ${O.toUpperCase()}`, NONCE.toUpperCase())).toBe(CODE)
  })

  it('answers empty for a part that is not the hex it must be', () => {
    expect(postCodeFragment(O.slice(2), NONCE)).toBe('')
    expect(postCodeFragment(O, `${NONCE}00`)).toBe('')
    expect(postCodeFragment(O, 'zz'.repeat(16))).toBe('')
  })
})

describe('the announcement', () => {
  it('is not a command-shaped name (the doctrine refuses :open, :toggle, :run, :invoke)', () => {
    expect(POST_CODE_EFFECT).toBe('entries:code')
    expect(POST_CODE_EFFECT).not.toMatch(/:(open|toggle|run|invoke)$/)
  })
})

describe('the shell mark', () => {
  const mark = `<meta name="${POST_SHELL_MARK_NAME}" content="${POST_SHELL_MARK_CONTENT}" />`

  it('is found in a page that wears it, in either quote and among other words', () => {
    expect(shellTakesPostCode(`<html><head>${mark}</head></html>`)).toBe(true)
    expect(shellTakesPostCode(`<meta content='other post' name='hypercomb-takes'>`)).toBe(true)
  })

  it('is not found where the page only describes it, or says something else', () => {
    expect(shellTakesPostCode(`<!-- ${mark} -->`)).toBe(false)
    expect(shellTakesPostCode('<meta name="hypercomb-takes" content="posts">')).toBe(false)
    expect(shellTakesPostCode('<meta name="hypercomb-take" content="post">')).toBe(false)
    expect(shellTakesPostCode('<meta name="description" content="post">')).toBe(false)
    expect(shellTakesPostCode('')).toBe(false)
    expect(shellTakesPostCode(undefined)).toBe(false)
  })

  it('the visitor shell wears it', () => {
    const html = readFileSync(join(__dirname, '..', '..', '..', 'hypercomb-web', 'src', 'index.visitor.html'), 'utf8')
    expect(shellTakesPostCode(html)).toBe(true)
  })
})

describe('the member kind and the exports', () => {
  it('30573 is named once, as OPEN_ENTRY_KIND, with a row in the vocabulary', () => {
    expect(OPEN_ENTRY_KIND).toBe(30573)
    expect(nostrKindEntry(30573)?.name).toBe('OPEN_ENTRY_KIND')
  })

  it('core exports the spelling and the nonce store', () => {
    for (const name of ['parsePostCode', 'isPostFragment', 'postCodeFragment', 'shellTakesPostCode',
      'POST_CODE_EFFECT', 'POST_CODE_PREFIX', 'POST_SHELL_MARK_NAME', 'POST_SHELL_MARK_CONTENT',
      'OPEN_ENTRY_KIND', 'EntryNonceStore', 'entryNonceStore', 'ENTRY_NONCE_STORE_IOC_KEY', 'entryNonceStorageKey']) {
      expect((core as Record<string, unknown>)[name], name).toBeDefined()
    }
  })
})
