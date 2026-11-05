// sharing/host-directory-identity.spec.ts
//
// THE DESK'S IDENTITY (jwize, 2026-11-05: "The host simple and advanced are
// underwhelming and need identity. Need to have a slick modern experience with icons
// and smooth"). Every host wears its own hexagon, every glyph is one the shipped font
// carries, and the desk moves only when something arrives — never on a repaint.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hostHue, hostInitial, kindGlyph } from './host-directory.view'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
const between = (from: string, to: string): string => VIEW.slice(VIEW.indexOf(from), VIEW.indexOf(to, VIEW.indexOf(from) + 1))

describe('every host its own hexagon', () => {
  it('turns the accent by the host name — one of twelve hues, the same every time', () => {
    for (const zone of ['hypercomb.com', 'jwize.com', 'try.localhost', 'meadow.localhost', 'a.b']) {
      const hue = hostHue(zone)
      expect(hue % 30).toBe(0)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(hostHue(zone)).toBe(hue)
    }
    // Spread, not clumped: a handful of real hosts land on several hues.
    const hues = new Set(['hypercomb.com', 'jwize.com', 'pluginthematrix.com', 'realones.online', 'cafesociety.buzz', 'pointblanksolutions.ca'].map(hostHue))
    expect(hues.size).toBeGreaterThanOrEqual(4)
  })

  it('carries the first letter or digit of the name, never www', () => {
    expect(hostInitial('hypercomb.com')).toBe('H')
    expect(hostInitial('www.jwize.com')).toBe('J')
    expect(hostInitial('4ever.io')).toBe('4')
    expect(hostInitial('—')).toBe('?')
  })

  it('draws the hexagon on the hue by role (relative colour), with this origin and your host as glyphs', () => {
    expect(VIEW).toMatch(/@supports \(color: oklch\(from red l c h\)\)\{\n\$\{S\} \.hd-avatar\{--hd-tint:oklch\(from rgb\(var\(--acc\)\) l c calc\(h \+ var\(--hd-hue,0\)\)\);\}/)
    const badge = between('const hostBadge = ', 'const glyphed = ')
    expect(badge).toMatch(/if \(own\) \{ badge\.classList\.add\('own'\); hex\.append\(glyph\('ownHostIcon'\)\) \}/)
    expect(badge).toMatch(/else if \(!zone\) \{ badge\.classList\.add\('home'\); hex\.append\(glyph\('homeIcon'\)\) \}/)
  })
})

describe('glyphs the font carries', () => {
  it('names a glyph for each kind of code file', () => {
    expect(kindGlyph('queen')).toBe('queenIcon')
    expect(kindGlyph('drone')).toBe('droneIcon')
    expect(kindGlyph('worker')).toBe('workerIcon')
    expect(kindGlyph('bee')).toBe('beeIcon')
    expect(kindGlyph('')).toBe('sourceIcon')
  })

  it('ships every ligature the desk names in every shell — and never `lightbulb_outline`, which no font has', () => {
    const table = between('const GLYPHS = {', '} as const')
    const names = [...table.matchAll(/\w+Icon: '([a-z0-9_]+)'/g)].map(match => match[1]!)
    expect(names.length).toBeGreaterThan(30)
    for (const shell of ['hypercomb-dev', 'hypercomb-web', 'hypercomb-shim']) {
      const subset = new Set(readFileSync(join(root, shell, 'public', 'fonts', 'icons.txt'), 'utf8').split(/\r?\n/).map(line => line.trim()))
      expect(names.filter(name => !subset.has(name)), shell).toEqual([])
    }
    expect(VIEW).not.toMatch(/lightbulb_outline/)
    // On is the filled bulb, off the outline of the same glyph.
    expect(VIEW).toMatch(/bulb\.append\(glyph\('bulbIcon', row\.on \? 'filled' : ''\)\)/)
  })

  it('hides every glyph from what is read out', () => {
    expect(between('const glyph = ', '/** The glyph a code file wears')).toMatch(/span\.setAttribute\('aria-hidden', 'true'\)/)
  })
})

describe('motion only where something arrives', () => {
  it('moves a page only when what it shows changes — deeper from the right, back from the left', () => {
    const mark = between('  #markEnter(', '  /** Something that has just appeared')
    expect(mark).toMatch(/last\.key !== key \? \(depth > last\.depth \? 'in' : depth < last\.depth \? 'out' : 'swap'\)/)
    // A repaint during an arrival carries it on where it was, instead of starting it again.
    expect(mark).toMatch(/if \(!enter && last && now - last\.at < ENTER_MS\) \{ enter = last\.enter; at = last\.at \}/)
    expect(mark).toMatch(/delete body\.dataset\['enter'\]/)
  })

  it('tells a drill page by its keys, never by names that change as reads land', () => {
    const simple = between('  #renderSimple(', '  /** The trail of where the drill is')
    expect(simple).toMatch(/this\.#stack\.keys\.join\(','\), model\.map\(column => column\.picked\.keys\.join\('\+'\)\)/)
  })

  it('reads the scroll before the page is emptied, and forgets what is gone', () => {
    const body = between('  #renderBody(): void {', '  /** The revisions column')
    expect(body.indexOf('this.#bodyScroll = body.scrollTop')).toBeLessThan(body.indexOf('body.replaceChildren()'))
    expect(body).toMatch(/for \(const key of \[\.\.\.this\.#entered\.keys\(\)\]\) if \(!this\.#seen\.has\(key\)\) this\.#entered\.delete\(key\)/)
  })

  it('stops for reduced motion', () => {
    expect(VIEW).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n\$\{S\} \*,\$\{S\} \*::before,\$\{S\} \*::after\{animation:none!important;transition:none!important;\}/)
  })

  it('never animates the desk with transform, which the docked panel pins', () => {
    const keyframes = [...VIEW.matchAll(/@keyframes hd-[\w-]+\{[^\n]*\}/g)].map(match => match[0]).join('\n')
    expect(keyframes).not.toMatch(/transform:/)
    expect(VIEW).toMatch(/transform:none!important;/)
  })
})
