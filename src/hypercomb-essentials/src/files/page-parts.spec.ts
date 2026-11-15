// page-parts.spec.ts — a page broken apart, and put back byte for byte.

import { describe, expect, it } from 'vitest'
import {
  MARKUP_PATH, PART_ATTR, SHELL_FILE, assemblePage, blockIdOf, describePage, looksLikePage, moveBlockOut, pageBlocks,
  pageMarkup, pageOutline, pagePartPath, pagePartText, partExtension, partTextRefusal, repinPart, shellParts,
} from './page-parts.js'

const sigOf = (letter: string): string => letter.repeat(64)

// The shape of the business card: a stylesheet, a JSON block, the app, a
// library kept as text, the animation. Tags written inside a script are that
// script's text, not blocks.
const CSS = ':root{ --bg:#060606 }\n.card{ color: gold }'
const THEMES = '{"honeycomb-edge":{"label":"Honeycomb Edge"}}'
const APP = "(() => { 'use strict'\n  const tag = '<style>not a block</style>'\n})()"
const LIBRARY = 'var zp=Object.defineProperty;'.repeat(40)
const ANIMATION = '/* Hypercomb card animation */\nstart()'
const PAGE = [
  '<!doctype html>', '<html><head><meta charset="utf-8">',
  `<style>${CSS}</style>`,
  `<script type="application/json" id="themes">${THEMES}</script>`,
  '</head><body><main id="card"></main>',
  `<script>${APP}</script>`,
  `<script type="text/plain" id="three-src">${LIBRARY}</script>`,
  `<script type="module">${ANIMATION}</script >`,
  '</body></html>', '',
].join('\n')

describe('the blocks of a page', () => {
  it('are its <style> and <script> blocks, in order, each named by kind and place', () => {
    const blocks = pageBlocks(PAGE)
    expect(blocks.map(block => block.id)).toEqual(['style-1', 'script-1', 'script-2', 'script-3', 'script-4'])
    expect(blocks.map(block => PAGE.slice(block.textStart, block.textEnd))).toEqual([CSS, THEMES, APP, LIBRARY, ANIMATION])
    expect(blocks[1]).toMatchObject({ type: 'application/json', elementId: 'themes', open: '<script type="application/json" id="themes">' })
  })

  it('a tag written inside a script is that script\'s text', () => {
    expect(pageBlocks(PAGE).filter(block => block.kind === 'style')).toHaveLength(1)
  })

  it('each takes the extension of what it is', () => {
    expect(pageBlocks(PAGE).map(partExtension)).toEqual(['css', 'json', 'js', 'txt', 'js'])
    expect(pageBlocks(PAGE).map(pagePartPath)).toEqual([
      'src/page/style-1.css', 'src/page/script-1.json', 'src/page/script-2.js', 'src/page/script-3.txt', 'src/page/script-4.js',
    ])
  })

  it('a block is said by its name, its path or its file', () => {
    expect(blockIdOf('script-3')).toBe('script-3')
    expect(blockIdOf('src/page/script-3.txt')).toBe('script-3')
    expect(blockIdOf('Script-3.js')).toBe('script-3')
  })
})

describe('the outline of a page', () => {
  it('counts every block and what is left over', () => {
    const outline = pageOutline(PAGE)
    expect(outline.characters).toBe(PAGE.length)
    expect(outline.blocks.map(block => block.characters)).toEqual([CSS, THEMES, APP, LIBRARY, ANIMATION].map(text => text.length))
    expect(outline.markupCharacters).toBe(PAGE.length - [CSS, THEMES, APP, LIBRARY, ANIMATION].join('').length)
    expect(outline.blocks[3]).toMatchObject({ block: 'script-3', type: 'text/plain', id: 'three-src' })
  })

  it('is what a reader hands a model: every part by its path, and how to break the page apart', () => {
    const said = describePage(PAGE, sigOf('a'))
    expect(said.text).toContain('This is its outline, not its text')
    expect(said.text).toContain('src/page/script-3.txt — <script type="text/plain" id="three-src">')
    expect(said.text).toContain(`read ${sigOf('a')} src/page/style-1.css`)
    expect(said.text).toContain('/part /<route of the tile that wears this page> <block> <name>')
    expect(said.text).toContain(SHELL_FILE)
    expect(said.sections.map(section => section.path)).toEqual([
      'src/page/style-1.css', 'src/page/script-1.json', 'src/page/script-2.js', 'src/page/script-3.txt', 'src/page/script-4.js', MARKUP_PATH,
    ])
    expect(said.text.length).toBeLessThan(4_000)
  })

  it('one part is read alone, and the markup is the page with each block\'s text left out', () => {
    expect(pagePartText(PAGE, 'src/page/script-4.js')).toBe(ANIMATION)
    expect(pagePartText(PAGE, MARKUP_PATH)).toBe(pageMarkup(PAGE))
    expect(pageMarkup(PAGE)).toContain('<script type="text/plain" id="three-src"></script>')
    expect(pageMarkup(PAGE)).not.toContain('defineProperty')
    expect(pagePartText(PAGE, 'src/page/script-9.js')).toBeUndefined()
  })

  it('knows a whole document from a fragment', () => {
    expect(looksLikePage(PAGE)).toBe(true)
    expect(looksLikePage('﻿<html lang="en"><body></body></html>')).toBe(true)
    expect(looksLikePage('<style>a{}</style>')).toBe(false)
    expect(looksLikePage('// src/main.ts\nexport {}')).toBe(false)
  })
})

describe('a block moved out, and the page put back', () => {
  const out = (shell: string, block: string, sig: string, name: string) => {
    const moved = moveBlockOut(shell, block, () => ({ sig, name }))
    if (!moved.ok) throw new Error(moved.error)
    return moved
  }

  it('the shell keeps the tag, empties it and names the part', () => {
    const moved = out(PAGE, 'script-3', sigOf('b'), 'three.txt')
    expect(moved.text).toBe(LIBRARY)
    expect(moved.shell).toContain(`<script type="text/plain" id="three-src" ${PART_ATTR}="resource:${sigOf('b')}/three.txt"></script>`)
    expect(moved.shell.length).toBeLessThan(PAGE.length - LIBRARY.length + 120)
    expect(shellParts(moved.shell)).toEqual([{ sig: sigOf('b'), name: 'three.txt' }])
  })

  it('assembling the shell gives the page back byte for byte, one block out or all of them', () => {
    const texts = new Map<string, string>()
    let shell = PAGE
    for (const [block, letter, name] of [['script-3', 'b', 'three.txt'], ['style-1', 'c', 'style.css'], ['script-4', 'd', 'animation.js'], ['script-1', 'e', 'themes.json'], ['script-2', 'f', 'app.js']] as const) {
      const moved = out(shell, block, sigOf(letter), name)
      texts.set(sigOf(letter), moved.text)
      shell = moved.shell
      const back = assemblePage(shell, sig => texts.get(sig))
      expect(back.ok && back.html).toBe(PAGE)
    }
    // A block keeps its name once others have left: the order is the document's.
    expect(pageBlocks(shell).map(block => block.id)).toEqual(['style-1', 'script-1', 'script-2', 'script-3', 'script-4'])
    expect(shell.length).toBeLessThan(900)
  })

  it('a part changed is a page changed in that block alone', () => {
    const moved = out(PAGE, 'script-4', sigOf('d'), 'animation.js')
    const repinned = repinPart(moved.shell, sigOf('d'), sigOf('9'))!
    const back = assemblePage(repinned, sig => (sig === sigOf('9') ? 'start({ colour: "teal" })' : undefined))
    expect(back.ok && back.html).toBe(PAGE.replace(ANIMATION, 'start({ colour: "teal" })'))
    expect(repinPart(moved.shell, sigOf('7'), sigOf('9'))).toBeUndefined()
  })

  it('refuses a block the page does not have, one already out, and an empty one', () => {
    expect(moveBlockOut(PAGE, 'script-9', () => ({ sig: sigOf('b'), name: 'x.js' }))).toMatchObject({ ok: false, error: expect.stringContaining('style-1, script-1') })
    const moved = out(PAGE, 'style-1', sigOf('c'), 'style.css')
    expect(moveBlockOut(moved.shell, 'style-1', () => ({ sig: sigOf('c'), name: 'style.css' }))).toMatchObject({ ok: false, error: 'style-1 is already a part: style.css' })
    expect(moveBlockOut('<!doctype html><script src="x.js"></script>', 'script-1', () => ({ sig: sigOf('b'), name: 'x.js' }))).toMatchObject({ ok: false, error: expect.stringContaining('empty') })
  })

  it('a part that is not here, or that would end its block early, stops the assembly', () => {
    const moved = out(PAGE, 'script-4', sigOf('d'), 'animation.js')
    expect(assemblePage(moved.shell, () => undefined)).toMatchObject({ ok: false, error: expect.stringContaining('animation.js') })
    expect(assemblePage(moved.shell, () => 'document.write("</script>")')).toMatchObject({ ok: false, error: expect.stringContaining('</script') })
    expect(partTextRefusal('style', 'a{}')).toBeUndefined()
    expect(partTextRefusal('script', "const end = '<' + '/script>'")).toBeUndefined()
  })
})
