// assistant/composed-parts.ts
//
// WHAT A TILE IS COMPOSED OF, AS ROWS. jwize, 2026-11-16, of the chat's code
// view: "This should be an alternate view to the tile tree then the requires
// attention and then code view where we can look at what the ai has created.
// It follows the hierarchy of composed parts."
//
// One tile's records make one level of that hierarchy:
//
//   • its PAGE, and what the page is made of: the shell and the files the
//     shell names (a page in parts, files/page-parts.ts), the traits the page
//     states and what fills each (website/trait-seat.ts), and the resources
//     the page names by signature;
//   • its CARD: the resources the card record names;
//   • the TRAITS the tile has that its page does not state;
//   • what ELSE is here: the tiles and files no part above already is.
//
// A part that is a tile is not composed here. It carries where to read
// (`unfold`), and the same function makes its level when it is unfolded.
// Two things are asked of another tile all the same. A child that holds a
// part the shell names is read once, for its files only, to find the file
// with the shell's signature. A tile that fills a trait the page states is
// asked whether it wears a page, when the page states more than one trait
// (a trait stated inside a filled one is never drawn).
//
// Pure: no DOM, no IoC, nothing registered. Everything is asked of a
// PartsReader (composed-parts-reader.ts holds the live one), so the rules
// here are proven with a reader made of maps.

import { sameTraitWord, type TraitResolution } from '@hypercomb/core'
import { SHELL_FILE, assemblePage, pageBlocks } from '../files/page-parts.js'
import { FRAME_MAX_CARRIED, inlineLinkedCode } from '../history/revision-viewer.model.js'
import { extractPageRefSigs } from '../sharing/decoration-closure.js'
import { recordResources } from './tile-holds.js'

/** What pressing a row opens in the main pane. Structurally an InspectFrame
 *  (inspect-window.view.ts), so it is handed to openChatCode as it is. */
export type PartOpens =
  | { readonly kind: 'tile'; readonly segments: readonly string[] }
  | {
    readonly kind: 'resource'; readonly sig: string; readonly name?: string
    /** Present only for a file on a tile: the pane can edit it and save it back. */
    readonly file?: { readonly route: readonly string[]; readonly name: string }
  }

export type PartHow = 'page' | 'shell' | 'script' | 'style' | 'trait' | 'picture' | 'named' | 'card' | 'field' | 'tile' | 'file' | 'more'

/** absent: its bytes are not on this device. filled, chosen, offered, own,
 *  empty: how a trait stands. stale: a shell the page no longer comes from. */
export type PartState = 'absent' | 'filled' | 'chosen' | 'offered' | 'own' | 'empty' | 'stale'

/** A tile read when it is unfolded. `claimed`: the files of it that the row
 *  above already is, left out of its level. */
export type PartAt = { readonly segments: readonly string[]; readonly claimed?: readonly string[] }

export type PartNode = {
  readonly key: string
  readonly how: PartHow
  /** '' = the view says the kind's word and twelve digits of `sig`. */
  readonly label: string
  readonly sig?: string
  readonly size?: number
  readonly state?: PartState
  /** How many were left out, on a `more` row. */
  readonly count?: number
  readonly opens?: PartOpens
  /** Read with this node (a page, a card): drawn open on arrival. */
  readonly children?: readonly PartNode[]
  /** A part that is a tile: read only when it is unfolded. */
  readonly unfold?: PartAt
}

/** One tile's level: its parts, then what else is here. */
export type Composition = { readonly parts: readonly PartNode[]; readonly also: readonly PartNode[] }

export type TileFile = { readonly name: string; readonly sig: string; readonly size: number }

export interface PartsReader {
  /** The tile's children and files, or null when it cannot be read. */
  tile(segments: readonly string[]): Promise<{
    readonly children: readonly { readonly name: string; readonly sig?: string }[]
    readonly files: readonly TileFile[]
  } | null>
  /** The page the tile wears, as the website view resolves it. */
  pageSig(segments: readonly string[]): Promise<string | null>
  /** Every trait the tile has, resolved by the renderer's own provider. */
  traits(segments: readonly string[]): Promise<readonly TraitResolution[]>
  /** The tile's card record, as the card page reads it. */
  card(segments: readonly string[]): Promise<{ readonly kind: string; readonly payload: Record<string, unknown> } | null>
  /** Page, shell and part text; null = its bytes are not reachable. */
  text(sig: string): Promise<string | null>
  /** This device only; a signature missing from the map is not held here. */
  held(sigs: readonly string[]): Promise<ReadonlyMap<string, { readonly size: number; readonly picture: boolean }>>
  /** The trait words a page states, in document order, one per folded word.
   *  `fills` says which words a filler is seated in: the walk is then the
   *  renderer's own, and a trait stated inside a filled one is not reported,
   *  because the drawn page never asks for it. */
  stated(html: string, fills?: (word: string) => boolean): readonly string[]
}

/** The key the view keeps a tile's row by. */
export const tileKey = (segments: readonly string[]): string => `tile:/${segments.join('/')}`

const gone = { state: 'absent' as const }

/** The newest file of each name: a file written twice is one file. */
const newest = (files: readonly TileFile[]): TileFile[] =>
  [...new Map(files.map(file => [file.name, file] as const)).values()]

/** FOR A LABEL ONLY, never to decide a row: the file name written after
 *  `resource:<signature>/` where the page names the resource. */
const nameAfter = (html: string, sig: string): string => {
  const at = html.indexOf(`resource:${sig}/`)
  const rest = at < 0 ? '' : html.slice(at + 74, at + 194)
  const end = rest.search(/["'\s)<>]/)
  return end > 0 ? rest.slice(0, end) : ''
}

/** Which named signatures are a sheet or a script by link. The frame's rule
 *  for that is private (inlineLinkedCode), so it is asked, with each
 *  signature standing in as its own text: a block whose tag carries the
 *  signature its body is, is that link. */
const linked = async (html: string): Promise<Map<string, 'style' | 'script'>> => {
  const out = new Map<string, 'style' | 'script'>()
  const probed = await inlineLinkedCode(html, async sig => new TextEncoder().encode(sig))
  if (probed === html) return out
  for (const block of pageBlocks(probed)) {
    const body = probed.slice(block.textStart, block.textEnd)
    if (body.length === 64 && block.open.includes(body)) out.set(body, block.kind)
  }
  return out
}

/**
 * One tile's level. ROW ORDER. parts: the page [its shell, the shell's file
 * parts in shell order, the traits it states in document order, the resources
 * it names in page order (at most FRAME_MAX_CARRIED, then how many more)], the
 * card [its fields in record order], the tile's other traits in record order.
 * also: tiles by name, then files by name.
 */
export async function composedParts(reader: PartsReader, at: PartAt): Promise<Composition> {
  const seg = at.segments
  const key = tileKey(seg)
  const tile = await reader.tile(seg)
  if (!tile) return { parts: [], also: [] }

  const files = newest(tile.files)
    .filter(file => !at.claimed?.includes(file.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const bySig = new Map(files.map(file => [file.sig, file] as const))
  /** The files and the child tiles a part row already is: never listed twice. */
  const used = new Set<string>()
  const taken = new Set<string>()
  const childNamed = (word: string) => tile.children.find(child => sameTraitWord(child.name, word))

  const fileRow = (file: TileFile, route: readonly string[], how: PartHow, rowKey: string, more: Partial<PartNode> = {}): PartNode => ({
    key: rowKey, how, label: file.name, sig: file.sig, size: file.size,
    opens: { kind: 'resource', sig: file.sig, name: file.name, file: { route: [...route], name: file.name } },
    ...more,
  })

  /** The tile a resolution settled on, as a route, or null when it settled
   *  on none that is a tile here. A chosen filler is a layer signature: it
   *  is a tile here only while a child still has that head. */
  const fillerRoute = (resolution: TraitResolution): readonly string[] | null => {
    if (resolution.rung === 'child' || resolution.rung === 'hive') return resolution.route
    if (resolution.rung !== 'fill') return null
    const picked = tile.children.find(child => child.sig === resolution.sig)
    return picked ? [...seg, picked.name] : null
  }

  /** One trait as a row, or null when a row above already is the tile that
   *  fills it. `own` is what states the trait: the shell, or the page. */
  const traitRow = (word: string, resolution: TraitResolution | undefined, own?: PartOpens): PartNode | null => {
    const node = { key: `${key}>trait:${word}`, how: 'trait' as const, label: word }
    const stands = (state: PartState): PartNode => ({ ...node, state, ...(own ? { opens: own } : {}) })
    // Stated by the page with nothing said about it on the tile: the page's
    // own version stands (website/trait-seat.ts composeTraits).
    if (!resolution || resolution.rung === 'own') return stands('own')
    if (resolution.rung === 'miss') return stands('empty')
    if (resolution.rung === 'choose') return stands('offered')
    const route = fillerRoute(resolution)
    if (!route) return { ...node, state: 'chosen', sig: resolution.sig, opens: { kind: 'resource', sig: resolution.sig, name: word } }
    const direct = route.length === seg.length + 1 && seg.every((segment, index) => segment === route[index])
    const child = direct ? childNamed(route[seg.length]!) : undefined
    if (child) {
      if (taken.has(child.name)) return null
      taken.add(child.name)
    }
    // A tile of the hive that is this tile or one above it is never unfolded
    // under itself.
    const above = route.length <= seg.length && route.every((segment, index) => segment === seg[index])
    return {
      ...node, state: resolution.rung === 'fill' ? 'chosen' : 'filled',
      opens: { kind: 'tile', segments: route },
      ...(above ? {} : { unfold: { segments: route } }),
    }
  }

  const parts: PartNode[] = []
  const [pageSig, traits, card] = await Promise.all([reader.pageSig(seg), reader.traits(seg), reader.card(seg)])
  const shellFile = files.find(file => file.name === SHELL_FILE)
  let stale = false
  let stated: readonly string[] = []

  if (pageSig) {
    const kids: PartNode[] = []
    const page = await reader.text(pageSig)
    const shell = shellFile ? await reader.text(shellFile.sig) : null
    const refs = shell === null ? [] : pageBlocks(shell).flatMap(block => block.part ? [{ ...block.part, kind: block.kind, id: block.id }] : [])
    const texts = new Map<string, string | null>()
    for (const ref of refs) if (!texts.has(ref.sig)) texts.set(ref.sig, await reader.text(ref.sig))
    const built = shell === null ? null : assemblePage(shell, sig => texts.get(sig) ?? undefined)
    // IN PARTS when the shell is proven (it assembles to exactly the page) or
    // cannot be proven either way (the page or a part is not here). A shell
    // that assembles to something else is stale: the page was written whole
    // since, and a save of the shell would overwrite the newer page.
    const unprovable = page === null || refs.some(ref => texts.get(ref.sig) === null)
    const inParts = shell !== null && (unprovable || (built?.ok === true && built.html === page))
    stale = shell !== null && !inParts

    const whole: PartOpens = { kind: 'resource', sig: pageSig, name: 'page' }
    let own: PartOpens = whole
    if (inParts && shellFile) {
      used.add(SHELL_FILE)
      const row = fileRow(shellFile, seg, 'shell', `${key}>shell`)
      own = row.opens!
      kids.push(row)
      /** Per child tile, every file of it that a part row of this shell is.
       *  A style and a script moved out under one name live on one child:
       *  each row's level leaves out both, so neither is listed again under
       *  the other. One list per child, complete when the loop ends. */
      const claims = new Map<string, string[]>()
      for (const ref of refs) {
        // By the block's place in the shell, never by its file name: two
        // blocks moved out under one name are two rows (breakBlockOut does
        // not refuse a name already used).
        const rowKey = `${key}>part:${ref.id}`
        const miss = texts.get(ref.sig) === null ? gone : {}
        const mine = bySig.get(ref.sig)
        // A part's file lives on the child tile of its name (page-parts-commit.ts breakBlockOut).
        const child = mine ? undefined : childNamed(ref.name.replace(/\.[^.]*$/, ''))
        const theirs = child ? newest((await reader.tile([...seg, child.name]))?.files ?? []).find(file => file.sig === ref.sig) : undefined
        // The row is a FILE only when a tile's file has the signature the
        // shell names: a save of any other file rebuilds nothing.
        if (mine) {
          used.add(mine.name)
          kids.push(fileRow(mine, seg, ref.kind, rowKey, miss))
        } else if (child && theirs) {
          taken.add(child.name)
          const claimed = claims.get(child.name) ?? []
          claims.set(child.name, claimed)
          if (!claimed.includes(theirs.name)) claimed.push(theirs.name)
          kids.push(fileRow(theirs, [...seg, child.name], ref.kind, rowKey, { ...miss, unfold: { segments: [...seg, child.name], claimed } }))
        } else {
          kids.push({ key: rowKey, how: ref.kind, label: ref.name, sig: ref.sig, opens: { kind: 'resource', sig: ref.sig, name: ref.name }, ...miss })
        }
      }
    }

    if (page !== null) {
      const all = reader.stated(page)
      // THE TREE SAYS WHAT THE HIVE DRAWS. The renderer replaces the element
      // of a trait a filler's page is seated in, and never asks for a trait
      // stated inside it (website/trait-seat.ts seatFillers). A filler is
      // seated only when its tile wears a page (composeTraits); with none,
      // the page's own version stands and what is inside it is still drawn.
      const seats: string[] = []
      if (all.length > 1) {
        for (const word of all) {
          const resolution = traits.find(trait => sameTraitWord(trait.word, word))
          const route = resolution ? fillerRoute(resolution) : null
          if (route && await reader.pageSig(route)) seats.push(word)
        }
      }
      stated = seats.length ? reader.stated(page, word => seats.some(have => sameTraitWord(have, word))) : all
    }
    for (const word of stated) {
      const row = traitRow(word, traits.find(trait => sameTraitWord(trait.word, word)), own)
      if (row) kids.push(row)
    }

    const html = page ?? (inParts ? shell : null)
    if (html) {
      const kinds = await linked(html)
      // A shell's part is not said again as a resource the page names. Only
      // when the part rows were drawn: a stale shell draws none, and the
      // page written whole since may name a former part by a link.
      const skip = new Set([pageSig, ...(inParts ? refs.map(ref => ref.sig) : [])])
      const named = extractPageRefSigs(html).filter(sig => !skip.has(sig))
      const shown = named.slice(0, FRAME_MAX_CARRIED)
      const held = await reader.held(shown.filter(sig => !bySig.has(sig)))
      for (const sig of shown) {
        const rowKey = `${key}>ref:${sig}`
        const file = bySig.get(sig)
        // A file on the tile: one row, with the file reference the pane edits by.
        if (file) {
          used.add(file.name)
          kids.push(fileRow(file, seg, kinds.get(sig) ?? 'file', rowKey))
          continue
        }
        const here = held.get(sig)
        const label = nameAfter(html, sig)
        kids.push({
          key: rowKey, how: kinds.get(sig) ?? (here?.picture ? 'picture' : 'named'), label, sig,
          ...(here ? { size: here.size } : gone),
          opens: { kind: 'resource', sig, name: label || sig.slice(0, 12) },
        })
      }
      if (named.length > shown.length) kids.push({ key: `${key}>more`, how: 'more', label: '', count: named.length - shown.length })
    }
    parts.push({ key: `${key}>page`, how: 'page', label: '', sig: pageSig, ...(page === null ? gone : {}), opens: whole, children: kids })
  }

  const fields = recordResources(card)?.named ?? []
  if (fields.length) {
    const held = await reader.held(fields.map(field => field.sig))
    parts.push({
      key: `${key}>card`, how: 'card', label: '',
      children: fields.map((field): PartNode => ({
        key: `${key}>card:${field.label}:${field.sig}`, how: 'field', label: field.label, sig: field.sig,
        ...(held.has(field.sig) ? { size: held.get(field.sig)!.size } : gone),
        opens: { kind: 'resource', sig: field.sig, name: field.label },
      })),
    })
  }

  // A trait the drawn page does not ask for belongs to the TILE: shown with
  // or without a page. That is a trait the page does not state, and one it
  // states only inside a trait that is filled.
  for (const trait of traits) {
    if (stated.some(word => sameTraitWord(word, trait.word))) continue
    const row = traitRow(trait.word, trait)
    if (row) parts.push(row)
  }

  const also: PartNode[] = [
    ...tile.children.map(child => child.name).filter(name => !taken.has(name)).sort((a, b) => a.localeCompare(b)).map((name): PartNode => ({
      key: tileKey([...seg, name]), how: 'tile', label: name,
      opens: { kind: 'tile', segments: [...seg, name] }, unfold: { segments: [...seg, name] },
    })),
    ...files.filter(file => !used.has(file.name)).map((file): PartNode => {
      const row = fileRow(file, seg, 'file', `${key}#${file.name}`)
      // A stale shell is read only: no file reference, so the pane offers no save.
      return stale && file.name === SHELL_FILE ? { ...row, state: 'stale', opens: { kind: 'resource', sig: file.sig, name: file.name } } : row
    }),
  ]
  return { parts, also }
}
