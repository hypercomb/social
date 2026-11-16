// website/page-style.spec.ts
import { describe, expect, it } from 'vitest'
import { atomLink, scopeAtoms, splitStyle } from './page-style.js'

const CSS = `@import url("more.css");
@font-face{font-family:'Rye';src:url(data:font/woff2;base64,AAAA) format('woff2')}
/* the palette */
:root{--ink:#221;--paper:#fff;color-scheme:light}
html, :root { --gap: 1rem }
body{margin:0;color:var(--ink)}
.card::after{content:"}";padding:var(--gap)}
@media (min-width:40rem){.card{display:grid}}
@keyframes rise{from{opacity:0}to{opacity:1}}`

describe('splitStyle', () => {
  const atoms = splitStyle(CSS)

  it('puts the faces in the type atom', () => {
    expect(atoms.type).toContain('@font-face')
    expect(atoms.type).toContain("font-family:'Rye'")
    expect(atoms.sheet).not.toContain('@font-face')
  })

  it('puts the root variables in the theme atom, and only those', () => {
    expect(atoms.theme).toBe(':root{--ink:#221;--paper:#fff}\n:root{--gap: 1rem}')
  })

  it('keeps what a root rule said besides variables in the sheet', () => {
    expect(atoms.sheet).toContain(':root{color-scheme:light}')
    expect(atoms.sheet).not.toContain('--paper')
  })

  it('keeps every other rule in the sheet, in order and intact', () => {
    expect(atoms.sheet).toContain('@import url("more.css");')
    expect(atoms.sheet).toContain('body{margin:0;color:var(--ink)}')
    expect(atoms.sheet).toContain('.card::after{content:"}";padding:var(--gap)}')
    expect(atoms.sheet).toContain('@media (min-width:40rem){.card{display:grid}}')
    expect(atoms.sheet).toContain('@keyframes rise{from{opacity:0}to{opacity:1}}')
    expect(atoms.sheet.indexOf('body{')).toBeLessThan(atoms.sheet.indexOf('@media'))
  })

  it('answers empty atoms for empty CSS', () => {
    expect(splitStyle('')).toEqual({ type: '', theme: '', sheet: '' })
  })
})

describe('scopeAtoms', () => {
  const scoped = scopeAtoms(splitStyle(CSS), 'page-abc')

  it('makes the page\'s root the class, so a lifted sheet cannot reach the hive', () => {
    expect(scoped.theme).toContain('.page-abc{--ink:#221;--paper:#fff}')
    expect(scoped.sheet).toContain('.page-abc{margin:0;color:var(--ink)}')
    expect(scoped.sheet).toContain('.page-abc .card::after')
    expect(scoped.sheet).not.toMatch(/(^|\n)body\{/)
  })

  it('confines rules inside a condition and leaves descriptions alone', () => {
    expect(scoped.sheet).toContain('@media (min-width:40rem){.page-abc .card{display:grid}}')
    expect(scoped.sheet).toContain('@keyframes rise{from{opacity:0}to{opacity:1}}')
    expect(scoped.type).toContain('@font-face{font-family:\'Rye\'')
  })

  it('keeps an empty atom empty', () => {
    expect(scopeAtoms({ type: '', theme: '', sheet: '.a{b:c}' }, 'p').type).toBe('')
  })
})

describe('atomLink', () => {
  it('links an atom by signature under a name a host serves as CSS', () => {
    expect(atomLink('theme', 'f'.repeat(64))).toBe(`<link rel="stylesheet" href="resource:${'f'.repeat(64)}/theme.css">`)
  })
})
