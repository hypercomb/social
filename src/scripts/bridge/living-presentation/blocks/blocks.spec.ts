// blocks.spec.ts — the living presentation's pages, pinned.
//
// Every page must stand alone and ask no other host for anything (doctrine
// T7); every medium it names must travel with it; every link must land on a
// page; every plate must stay inside its frame; every beat must have its
// voice; and every picture in captures/ must be on a page. Nothing else checks
// these before a page is planted in a hive.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const require_ = createRequire(import.meta.url)
const { buildBlocks } = require_('./build.cjs')
const { linkTo } = require_('./preview.cjs')
const content = require_('./content.cjs')
const tour = require_('./tour.cjs')

const { blocks, media } = buildBlocks()
const sigs = new Set(media.map((m: { sig: string }) => m.sig))
const paged = new Set(blocks.map((b: { route: string[] }) => b.route.join('/')))
const plateNames = readdirSync(join(__dirname, 'plates')).filter(f => f.endsWith('.cjs') && f !== 'pieces.cjs').map(f => f.slice(0, -4))

describe('every page stands alone', () => {
  for (const b of blocks) {
    const at = '/' + b.route.join('/')
    it(`${at} loads nothing from another host`, () => {
      const loads = [
        ...b.page.matchAll(/\b(?:src|srcset|poster|data)=["']\s*(?:https?:)?\/\/[^"']*/gi),
        ...b.page.matchAll(/url\(\s*["']?\s*(?:https?:)?\/\/[^)]*/gi),
        ...b.page.matchAll(/<link\b[^>]*href=["']\s*(?:https?:)?\/\/[^"']*/gi),
        ...b.page.matchAll(/@import\b[^;]*/gi),
        ...b.page.matchAll(/\bfetch\(\s*["'`]\s*(?:https?:)?\/\//gi),
      ].map(m => m[0])
      expect(loads).toEqual([])
    })

    it(`${at} names only media that travel with it`, () => {
      const named = [...b.page.matchAll(/resource:([0-9a-f]{64})/g)].map(m => m[1])
      expect(named.filter(sig => !sigs.has(sig))).toEqual([])
    })

    it(`${at} links only to pages`, () => {
      const hrefs = [...b.page.matchAll(/href="([^"#][^"]*)"/g)].map(m => m[1]).filter(h => !/^https?:/.test(h))
      for (const href of hrefs) expect(() => linkTo(href, b.route, paged)).not.toThrow()
    })
  }
})

describe('the tour is placed whole', () => {
  it('places every scene from 1 to 25 exactly once', () => {
    expect([...tour.placed()].sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })
})

describe('every beat has its voice', () => {
  const beats = Object.entries(content as Record<string, { beats?: { say: string }[] }>)
    .flatMap(([route, block]) => (block.beats || []).map(b => ({ route, say: b.say })))
  it('finds the beats', () => expect(beats.length).toBeGreaterThan(0))
  it('has a recorded voice for every one (blocks/narrate.cjs)', () => {
    expect(beats.filter(b => !tour.T.cachePath(b.say))).toEqual([])
  })
})

/** Every coordinate a plate draws at, read from its attributes and paths. */
const pointsOf = (svg: string): { x: number[], y: number[] } => {
  const x: number[] = [], y: number[] = []
  for (const m of svg.matchAll(/\s(x|x1|x2|cx)="(-?[\d.]+)"/g)) x.push(+m[2])
  for (const m of svg.matchAll(/\s(y|y1|y2|cy)="(-?[\d.]+)"/g)) y.push(+m[2])
  for (const m of svg.matchAll(/<rect\b[^>]*\sx="(-?[\d.]+)"[^>]*\swidth="([\d.]+)"/g)) x.push(+m[1] + +m[2])
  for (const m of svg.matchAll(/<rect\b[^>]*\sy="(-?[\d.]+)"[^>]*\sheight="([\d.]+)"/g)) y.push(+m[1] + +m[2])
  for (const m of svg.matchAll(/points="([^"]+)"/g)) for (const p of m[1].trim().split(/\s+/)) { const [a, b] = p.split(','); x.push(+a); y.push(+b) }
  // A path's absolute commands: H takes an x, V a y, A ends on a point after
  // five other numbers, the rest are x,y pairs. Relative steps are skipped.
  for (const m of svg.matchAll(/\sd="([^"]+)"/g)) {
    for (const [, cmd, args] of m[1].matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      const n = args.match(/-?[\d.]+/g)?.map(Number) ?? []
      if (cmd === 'H') x.push(...n)
      else if (cmd === 'V') y.push(...n)
      else if (cmd === 'A') for (let i = 0; i + 6 < n.length; i += 7) { x.push(n[i + 5]); y.push(n[i + 6]) }
      else if (cmd === cmd.toUpperCase() && cmd !== 'Z') for (let i = 0; i + 1 < n.length; i += 2) { x.push(n[i]); y.push(n[i + 1]) }
    }
  }
  return { x, y }
}

describe('every plate stays inside its frame', () => {
  for (const name of plateNames) {
    it(`${name} draws inside its viewBox`, () => {
      const svg: string = require_(`./plates/${name}.cjs`)()
      const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!.map(Number)
      // markers are drawn in their own little box, not the plate's
      const { x, y } = pointsOf(svg.replace(/<defs>[\s\S]*?<\/defs>/g, ''))
      expect(x.filter(v => v < 0 || v > w)).toEqual([])
      expect(y.filter(v => v < 0 || v > h)).toEqual([])
    })
  }

  it('names a plate that exists for every block that has one', () => {
    const named = Object.values(content as Record<string, { plate?: string }>).map(b => b.plate).filter(Boolean)
    expect(named.filter(p => !plateNames.includes(p as string))).toEqual([])
  })
})

describe('every picture is on a page', () => {
  it('leaves nothing in captures/ that no page shows', () => {
    const shown = new Set(Object.values(content as Record<string, { live?: { shot: string }[] }>).flatMap(b => (b.live || []).map(l => l.shot)))
    const kept = readdirSync(join(__dirname, 'captures')).map(f => f.replace(/\.(webp|png)$/, ''))
    expect(kept.filter(k => !shown.has(k))).toEqual([])
  })
})
