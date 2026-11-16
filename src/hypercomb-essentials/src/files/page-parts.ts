// files/page-parts.ts
//
// A PAGE IN PARTS. A website page that grew up as one document carries its
// stylesheet, its scripts and often a whole library inline: the business card
// is 998 KB, 704 KB of it one library. A model cannot hold that, and a write
// of it is refused for its size, so nothing in it could be changed
// (business-card.jwize.com, 2026-11-15: three conversations ended on it).
//
// The page is BROKEN APART (documentation/website-artifact-paradigm.md,
// documentation/atomic-chain.md): a <style> or <script> block moves out into
// a file of its own on a tile of its own, and the page keeps a SHELL — the
// same document with that block emptied and a reference left on its tag:
//
//   <script id="anim" data-hc-part="resource:<signature>/animation.js"></script>
//
// The reference is a name and a signature (atomic-chain.md "References"): the
// signature is the version in use and never moves on its own.
//
// THE PAGE THAT IS SERVED STAYS ONE DOCUMENT. A card's door answers with the
// page's own bytes and refuses a page that loads a script from elsewhere, and
// a managed door frames the page with no network. So the page of record is
// the shell ASSEMBLED: every reference filled with its part's text, the
// attribute taken back off. Assembling a shell made from a page gives that
// page back byte for byte, which is what `breaksClean` proves before a block
// is ever moved.
//
// Pure: text in, text out. The tiles, files and records are page-parts.drone.ts.

/** The attribute a moved-out block's tag wears in the shell. */
export const PART_ATTR = 'data-hc-part'

/** The file a page's shell is kept in, on the page's own tile. */
export const SHELL_FILE = 'page.shell.html'

export type PageBlockKind = 'style' | 'script'

export type PageBlock = {
  /** `style-1`, `script-3`: its kind and its place among that kind, in document order. */
  readonly id: string
  readonly kind: PageBlockKind
  /** The opening tag as written, `<script type="module">`. */
  readonly open: string
  /** The tag's `type` and `id`, when it has them. */
  readonly type?: string
  readonly elementId?: string
  /** Where the opening tag starts, where its text starts and ends, where the closing tag ends. */
  readonly start: number
  readonly textStart: number
  readonly textEnd: number
  readonly end: number
  /** The part this block was moved out to, in a shell. */
  readonly part?: PartReference
}

export type PartReference = { readonly sig: string; readonly name: string }

const BLOCK = /<(style|script)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi
const REFERENCE = new RegExp(`\\s${PART_ATTR}="resource:([0-9a-f]{64})/([^"/\\s]+)"`)
const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)?.slice(1).find(value => value !== undefined)

/** Every <style> and <script> block of a document, in order. A block inside
 *  another block's text (a tag written in a string) is that block's text. */
export const pageBlocks = (html: string): PageBlock[] => {
  const blocks: PageBlock[] = []
  const counts: Record<PageBlockKind, number> = { style: 0, script: 0 }
  for (const found of String(html ?? '').matchAll(BLOCK)) {
    const kind = found[1].toLowerCase() as PageBlockKind
    const attrs = found[2]
    const open = `<${found[1]}${attrs}>`
    const start = found.index ?? 0
    const textStart = start + open.length
    const reference = REFERENCE.exec(attrs)
    const type = attr(attrs, 'type')
    const elementId = attr(attrs, 'id')
    blocks.push({
      id: `${kind}-${counts[kind] += 1}`, kind, open, start, textStart,
      textEnd: textStart + found[3].length, end: start + found[0].length,
      ...(type ? { type } : {}), ...(elementId ? { elementId } : {}),
      ...(reference ? { part: { sig: reference[1], name: reference[2] } } : {}),
    })
  }
  return blocks
}

/** Is this text a whole HTML document, as far as its first bytes say? */
export const looksLikePage = (text: string): boolean =>
  /^﻿?\s*(?:<!doctype\s+html|<html[\s>])/i.test(String(text ?? '').slice(0, 256))

export type OutlinedBlock = {
  readonly block: string
  readonly kind: PageBlockKind
  readonly characters: number
  readonly type?: string
  readonly id?: string
  /** How the block's text begins, on one line. */
  readonly begins?: string
  /** The file the block lives in, when it has been moved out. */
  readonly part?: string
}

export type PageOutline = {
  readonly characters: number
  /** Everything that is not inside a <style> or <script> block. */
  readonly markupCharacters: number
  readonly blocks: readonly OutlinedBlock[]
}

const BEGINS = 80

/** What a page is made of: each block with its size, and what is left over.
 *  The answer to "what is in this 1 MB page" that fits in a model's reply. */
export const pageOutline = (html: string): PageOutline => {
  const text = String(html ?? '')
  const blocks = pageBlocks(text)
  const inside = blocks.reduce((sum, block) => sum + (block.textEnd - block.textStart), 0)
  return {
    characters: text.length,
    markupCharacters: text.length - inside,
    blocks: blocks.map(block => {
      const body = text.slice(block.textStart, block.textEnd)
      const begins = body.trim().slice(0, BEGINS).replace(/\s+/g, ' ')
      return {
        block: block.id, kind: block.kind, characters: body.length,
        ...(block.type ? { type: block.type } : {}), ...(block.elementId ? { id: block.elementId } : {}),
        ...(begins ? { begins } : {}), ...(block.part ? { part: block.part.name } : {}),
      }
    }),
  }
}

/** The extension a block's file takes: what it is, read from its tag. */
export const partExtension = (block: Pick<PageBlock, 'kind' | 'type'>): string => {
  if (block.kind === 'style') return 'css'
  const type = String(block.type ?? '').trim().toLowerCase()
  if (!type || type === 'module' || /(?:java|ecma)script/.test(type)) return 'js'
  if (/json/.test(type)) return 'json'
  return 'txt'
}

// ── a page read by part ──────────────────────────────────────────────────
//
// The chat's read grammar opens a section of a signature by a `src/…` path
// (a module's source files). A page's blocks answer to the same spelling, so
// no new grammar is needed: `read <signature> src/page/script-3.js`.

const PAGE_PATH = 'src/page/'
/** Everything outside the blocks: the document with each block's text left out. */
export const MARKUP_PATH = `${PAGE_PATH}markup.html`

/** The path a block is read by. */
export const pagePartPath = (block: Pick<PageBlock, 'id' | 'kind' | 'type'>): string =>
  `${PAGE_PATH}${block.id}.${partExtension(block)}`

/** `script-3` from `script-3`, `src/page/script-3.js` or `script-3.js`. */
export const blockIdOf = (said: string): string => {
  const word = String(said ?? '').trim().toLowerCase()
  const name = word.startsWith(PAGE_PATH) ? word.slice(PAGE_PATH.length) : word
  return /^(?:style|script)-\d+\.[a-z0-9]+$/.test(name) ? name.replace(/\.[a-z0-9]+$/, '') : name
}

/** The document with every block's text left out: its markup, and each
 *  block's own tag where the block stands. */
export const pageMarkup = (html: string): string => {
  const text = String(html ?? '')
  const out: string[] = []
  let at = 0
  for (const block of pageBlocks(text)) {
    out.push(text.slice(at, block.textStart))
    at = block.textEnd
  }
  out.push(text.slice(at))
  return out.join('')
}

/** One part of a page by its path, or undefined when the page has none such. */
export const pagePartText = (html: string, path: string): string | undefined => {
  const text = String(html ?? '')
  if (String(path ?? '').trim().toLowerCase() === MARKUP_PATH) return pageMarkup(text)
  const id = blockIdOf(path)
  const block = pageBlocks(text).find(candidate => candidate.id === id)
  return block ? text.slice(block.textStart, block.textEnd) : undefined
}

const counted = (n: number): string => n.toLocaleString('en-US')

/** The outline as the reader hands it to a model: what the page is made of,
 *  how to open one part, and how to break the page apart to change it. */
export const describePage = (html: string, sig: string): { text: string; sections: { path: string; lines: number }[] } => {
  const text = String(html ?? '')
  const outline = pageOutline(text)
  const blocks = pageBlocks(text)
  const lines = (from: number, to: number): number => text.slice(from, to).split('\n').length
  const rows = blocks.map((block, index) => {
    const row = outline.blocks[index]
    const tag = `<${block.kind}${block.type ? ` type="${block.type}"` : ''}${block.elementId ? ` id="${block.elementId}"` : ''}>`
    return `${pagePartPath(block)} — ${tag}, ${counted(row.characters)} characters${row.part ? `, kept in the part ${row.part}` : ''}${row.begins ? ` — begins: ${row.begins}` : ''}`
  })
  const markup = pageMarkup(text)
  return {
    text: [
      `A PAGE OF ${counted(outline.characters)} CHARACTERS, too long to read whole. This is its outline, not its text.`,
      '',
      ...rows,
      `${MARKUP_PATH} — everything else: the document with each block's text left out, ${counted(markup.length)} characters`,
      '',
      `Open one part: read ${sig} ${blocks[0] ? pagePartPath(blocks[0]) : MARKUP_PATH} (a long part continues with the "next" it gives). Read only the part the request is about.`,
      'To CHANGE a page this long, break it apart first: a change block with the line',
      '  /part /<route of the tile that wears this page> <block> <name>',
      `for example /part /card ${blocks[blocks.length - 1]?.id ?? 'script-1'} animation. That moves the block into a file of its own on the child tile <name>; the page itself does not change. Then change that file with a write block (file /<route>/<name> <name>.<its extension>, SEARCH/REPLACE edits) and the hive rebuilds the page from its parts. The markup is the file ${SHELL_FILE} on the page's own tile once a block has been moved out.`,
      `ALREADY IN PARTS? This outline is of the page as served and cannot tell. Read the tile that wears the page: when its files list ${SHELL_FILE}, the blocks have files already, each on the child tile of its name (read that tile for the file and its signature). Change that file; do not break the block apart again.`,
    ].join('\n'),
    sections: [
      ...blocks.map(block => ({ path: pagePartPath(block), lines: lines(block.textStart, block.textEnd) })),
      { path: MARKUP_PATH, lines: markup.split('\n').length },
    ],
  }
}

/** Text a block of this kind cannot hold: its own closing tag ends the block
 *  wherever it is written, so a part carrying one would cut the page short. */
export const partTextRefusal = (kind: PageBlockKind, text: string): string | undefined =>
  new RegExp(`</${kind}`, 'i').test(String(text ?? ''))
    ? `the text holds </${kind}, which would end the block early; write it another way (for example '<' + '/${kind}>')`
    : undefined

export type ShellMove =
  | { readonly ok: true; readonly shell: string; readonly text: string; readonly block: PageBlock }
  | { readonly ok: false; readonly error: string }

/** The shell with one block moved out: its text taken, a reference left on
 *  its tag. `name` is the file's name; the signature is the text's own. */
export const moveBlockOut = (shell: string, blockId: string, reference: (text: string) => PartReference): ShellMove => {
  const text = String(shell ?? '')
  const blocks = pageBlocks(text)
  const block = blocks.find(candidate => candidate.id === String(blockId ?? '').trim().toLowerCase())
  if (!block) {
    return { ok: false, error: `the page has no block ${blockId}; it has ${blocks.map(candidate => candidate.id).join(', ') || 'none'}` }
  }
  if (block.part) return { ok: false, error: `${block.id} is already a part: ${block.part.name}` }
  const body = text.slice(block.textStart, block.textEnd)
  if (!body.trim()) return { ok: false, error: `${block.id} is empty; there is nothing to move out` }
  if (new RegExp(`\\s${PART_ATTR}\\b`).test(block.open)) return { ok: false, error: `${block.id} already wears ${PART_ATTR}` }
  const to = reference(body)
  const open = `${block.open.slice(0, -1)} ${PART_ATTR}="resource:${to.sig}/${to.name}">`
  return {
    ok: true, text: body, block,
    shell: `${text.slice(0, block.start)}${open}${text.slice(block.textEnd)}`,
  }
}

export type Assembled =
  | { readonly ok: true; readonly html: string; readonly parts: readonly PartReference[] }
  | { readonly ok: false; readonly error: string }

/** The page a shell stands for: every reference filled with its part's text
 *  and the attribute taken back off. `textOf` answers a part's text by its
 *  signature, or undefined when it is not here. */
export const assemblePage = (shell: string, textOf: (sig: string) => string | undefined): Assembled => {
  const text = String(shell ?? '')
  const out: string[] = []
  const parts: PartReference[] = []
  let at = 0
  for (const block of pageBlocks(text)) {
    if (!block.part) continue
    const body = textOf(block.part.sig)
    if (body === undefined) return { ok: false, error: `the part ${block.part.name} (${block.part.sig.slice(0, 12)}…) is not on this device` }
    const refused = partTextRefusal(block.kind, body)
    if (refused) return { ok: false, error: `${block.part.name}: ${refused}` }
    out.push(text.slice(at, block.start), block.open.replace(REFERENCE, ''), body)
    at = block.textEnd
    parts.push(block.part)
  }
  out.push(text.slice(at))
  return { ok: true, html: out.join(''), parts }
}

/** The parts a shell names, in order. */
export const shellParts = (shell: string): PartReference[] =>
  pageBlocks(shell).flatMap(block => block.part ? [block.part] : [])

/** The shell with one part's reference moved to a newer signature: the
 *  forward commit of atomic-chain.md. Undefined when it names no such part. */
export const repinPart = (shell: string, from: string, to: string): string | undefined => {
  const text = String(shell ?? '')
  const held = `${PART_ATTR}="resource:${from}/`
  return text.includes(held) ? text.split(held).join(`${PART_ATTR}="resource:${to}/`) : undefined
}
