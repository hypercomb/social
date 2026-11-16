// files/part.queen.ts
//
// /part — ONE BLOCK OF A PAGE BECOMES A FILE OF ITS OWN.
//
// A website page that grew up as one document cannot be changed by a model:
// the business card is 998 KB, a write of it is refused for its size, and a
// model reading it a page at a time ran out of room before it found the line
// it was asked to change (business-card.jwize.com, 2026-11-15, three
// conversations). The page has to be broken apart first
// (documentation/website-artifact-paradigm.md), and that is one word:
//
//   part /<route> <block> <name>
//
// <route> is the tile that wears the page. <block> is one of the blocks the
// page's outline lists (`read <page signature>`): `script-3`, or its path
// `src/page/script-3.js`. <name> is the child tile the block moves to. The
// block's text becomes `<name>.<ext>` on /<route>/<name>, and the page's tile
// keeps `page.shell.html`, the page with that block emptied and referenced.
//
// THE PAGE DOES NOT CHANGE. The shell is proven to assemble back to the page
// byte for byte before anything is filed (files/page-parts-commit.ts). What
// changes is what can be done next: the file is a text file on a tile, so a
// write block changes it, and the hive rebuilds the page from its parts.
//
// What it writes: a child tile when the name is new, one file on it, one file
// on the page's tile. Nothing is signed, nothing is published, nothing
// leaves this hive.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { breakBlockOut } from './page-parts-commit.js'
import { blockIdOf } from './page-parts.js'

export const PART_FORMS = 'part /<route> <block> <name>'

const FORM = /^(\/\S*)\s+(\S+)\s+(\S+)$/
const BLOCK = /^(?:style|script)-\d+$/
const unsafe = (part: string): boolean => part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part)

export type PartRequest = { readonly route: readonly string[]; readonly block: string; readonly name: string }

/** What a part line asks for, or the reason it asks for nothing. */
export const parsePart = (args: string): PartRequest | string => {
  const match = FORM.exec(String(args ?? '').trim())
  if (!match) return `part needs the page's tile, a block and a name: ${PART_FORMS}`
  const route = match[1].split('/').map(part => part.trim()).filter(Boolean)
  if (!route.length) return `the first page wears no page of its own; name the tile: ${PART_FORMS}`
  if (route.some(unsafe)) return `that is not a page of this hive: ${PART_FORMS}`
  const block = blockIdOf(match[2])
  if (!BLOCK.test(block)) return `"${match[2]}" is not a block; the page's outline lists them (style-1, script-2, …): ${PART_FORMS}`
  const name = match[3].toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return `"${match[3]}" is not a tile name: lower-case letters, digits and hyphens: ${PART_FORMS}`
  return { route, block, name }
}

type TreeReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes: number; withContent: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false; code?: string }
  >
}

const service = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

export class PartQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'part'
  override description = 'Move one block of a long page into a file of its own on a child tile'
  override options = ['/<route> <block> <name>']
  override examples = [
    { input: '/part /card script-3 animation', result: 'Moves the third script of the page on /card into animation.js on the tile /card/animation' },
    { input: '/part /card style-1 style', result: 'Moves the first stylesheet into style.css on the tile /card/style' },
  ]
  // A route is a place, never other words.
  override rawArgs = true

  // OFFERED TO A MODEL. EDITING, not additive: the page's tile gains a file
  // that the page is rebuilt from, so what the tile holds is changed, though
  // the page's own bytes are proven unchanged. HIVE: it writes on the tile a
  // route names and on a child of it, wherever the participant stands.
  // Nothing is signed or published.
  override machine = {
    forms: '/<route> <block> <name>',
    example: '/part /card script-3 animation',
    reach: 'editing' as const,
    scope: 'hive' as const,
    consequence: 'Moves one block of the page worn by the tile at /<route> into a file of its own: <name>.css, .js, .json or .txt on the child tile /<route>/<name>, which is made when it is not there. <block> is one the page\'s outline lists (read the page\'s signature): style-1, script-3. The page itself does not change by one byte. Its tile keeps page.shell.html, the page with that block emptied and referenced. From then on the block is changed in its file with a write block (file /<route>/<name> <name>.<ext>), and the hive rebuilds the page from its parts; the page is no longer written whole. Use it before changing a page too long to read.',
    refuse: (args: string): string | undefined => {
      const asked = parsePart(args)
      return typeof asked === 'string' ? asked : undefined
    },
  }

  protected async execute(args: string): Promise<void> {
    const asked = parsePart(args)
    if (typeof asked === 'string') throw new Error(asked)

    // The tile as the hive spells it, or no tile at all.
    const reader = service<TreeReaderLike>('@diamondcoreprocessor.com/HypercombHiveTreeReader')
    if (!reader?.readNode) throw new Error('part cannot read this hive here; nothing was changed')
    const segments: string[] = []
    for (const part of asked.route) {
      const listed = await reader.readNode(segments, { maxBytes: 8_000, withContent: false }).catch(() => null)
      const found = listed?.ok ? listed.children.map(child => child.name).find(child => child.toLowerCase() === part.toLowerCase()) : undefined
      if (!found) throw new Error(`there is no tile at /${[...segments, part].join('/')}; nothing was changed`)
      segments.push(found)
    }

    const out = await breakBlockOut(segments, asked.block, asked.name)
    if (!out.ok) throw new Error(`${out.error}. Nothing was changed`)
    const where = `/${out.tile.join('/')}`
    const message = `${asked.block} of /${segments.join('/')} is now ${out.file} on ${where} (${out.characters.toLocaleString('en-US')} characters)${out.restarted ? '; the page had been written whole since it was last broken apart, so its parts start again from the page as it is' : ''}`
    EffectBus.emit('toast:show', { type: 'success', message })
    EffectBus.emit('activity:log', { message, icon: '●' })
  }
}

const _part = new PartQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PartQueenBee', _part)
