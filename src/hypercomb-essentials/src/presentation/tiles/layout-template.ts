// presentation/tiles/layout-template.ts
//
// A LAYOUT IS AN ARTIFACT. A CONTAINER OPTS INTO ONE. NOTHING IS A PARENT.
//
// visual-division.ts gives a whole an ANONYMOUS frame: how many holes and how
// they flow, minted for that one whole and belonging to nobody else. That is
// enough to break a tile apart, and not enough to DESIGN with — two wholes
// that should read the same have two unrelated frames, and changing the design
// means editing both.
//
// A layout template is the same frame, NAMED and SHARED. One resource; N
// containers bound to it are N references, never N copies (the pattern/frame
// split does exactly this for the hex grid — sequence/pattern.ts). Edit the
// template and every place bound to it follows.
//
// ── OPTING INTO A LAYOUT IS NOT ACQUIRING A PARENT ──────────────────────
//
// The binding is a MARK the container wears (`layout:template`, see
// template-target.ts), pointing at the template by signature. The template
// holds nothing, knows none of its users, and can be deleted without orphaning
// them. A tile is never inside a layout; it WEARS one. That is the whole
// difference between this and a component tree, and it is why a container can
// be moved, shared or adopted alone and still look like itself.
//
// ── A HOLE IS AN INTERFACE ──────────────────────────────────────────────
//
// A hole states a NAME and a SHARE OF THE AXIS, and says nothing about who
// fills it — the same rule visual-division.ts states for regions. Seating
// comes from the other side: a member's enrolment mark carries its position
// (`{ sig, meaning, order }`), and order k seats into member-hole k. So one
// part sits in many layouts at a different place in each, and no layout knows
// the others exist.
//
// ── THE VARIABLES ARE THE DESIGN, AND THEY INHERIT ──────────────────────
//
// This is the part the original struggled with, so it is worth stating as a
// rule rather than a detail.
//
// The instinct is to give each layout its own variable namespace —
// `--split-space`, `--rail-space`, `--bookends-space` — and alias it to a local
// `--space` inside the component. It reads as tidy and it destroys the one
// property that makes nesting worth having: a re-declared alias STOPS
// INHERITING. Set the
// gutter on the outer container and the inner one, having re-aliased its own,
// ignores you. Every level then has to be dressed by hand, which is not a
// layout system, it is four stylesheets that resemble each other.
//
// So there is ONE vocabulary, unprefixed by layout type, declared where it is
// overridden and NOWHERE ELSE:
//
//     --hc-layout-space      gap between holes            (any CSS length)
//     --hc-layout-padding    inset around the whole set   (any CSS length)
//     --hc-layout-<hole>     the fixed extent of one hole (any CSS length)
//
// A container declares only what it CHANGES. Everything else falls through
// from the container above it, all the way up. Nest a `split` inside the body
// of a turned `rail` and it is already dressed; give the inner one
// `--hc-layout-space: 2rem` and only it and its descendants move. That is what
// "totally flexible" has to mean to be worth anything: one name, inherited,
// overridable at any depth.
//
// Margins are not used, and there are no margin resets. `gap` spaces holes
// WITHOUT putting space outside the set, which is the entire job the old
// `margin-reset-vertical` / `margin-reset-horizontal` mixins were doing by
// hand — and doing per layout, per edge, per nth-child. `padding` then means
// what it says, and the two compose under nesting instead of fighting.
//
// ── NO nth-child ANYWHERE ───────────────────────────────────────────────
//
// A layout whose sizing lives in `> div:nth-child(2)` has its arity welded
// into a stylesheet: five holes need five rules, and a six-hole variant is a
// new file. Here every hole carries its own `flex` inline, derived from its
// own declaration, so arity is data. A template with eleven holes needs no
// code at all.
//
// This module is PURE — data in, strings out. No IoC, no DOM, no store, so the
// same function builds a container at publish time, in the browser, and in a
// test. The writes and the binding live in template-target.ts.
//
// See documentation/layout-templates.md.

import { SLOT_ATTR } from './visual-division.js'

/** The resource's own `kind` field — what a template JSON says it is. */
export const LAYOUT_TEMPLATE_KIND = 'layout-template'

/** Attribute naming a hole, beside the positional `data-hc-slot`. The NAME is
 *  for the designer and the inspector; the INDEX is what a member seats by.
 *  Both are on the element because they answer different questions. */
export const HOLE_ATTR = 'data-hc-hole'

/** Marks the hole a container's OWN page occupies. It carries no slot index
 *  and no member can seat into it — a whole is not one of its own parts. */
export const SELF_ATTR = 'data-hc-self'

/** A hole's BEHAVIOUR, written onto the element: `fixed` or `fluid`, and a
 *  `band` flag when it breaks the line.
 *
 *  It is on the element rather than kept in the designer because the designer
 *  must not hold a second opinion about how a hole behaves — a border that
 *  says "this one grows" while the flex says otherwise is worse than no border
 *  at all. Two data attributes in the published markup is the cheap price of
 *  the two agreeing by construction. */
export const FILL_ATTR = 'data-hc-fill'
export const BAND_ATTR = 'data-hc-band'

/** WHAT A HOLE IS FOR, conventionally named: `data-hc-meaning="site:masthead"`.
 *
 *  A hole says what belongs in it without naming who supplies it — the same
 *  rule the shape follows, one level up. `site:masthead` is a name anybody can
 *  arrive at from the outside, so two people who never met can agree on what
 *  fills a hole by agreeing on a word.
 *
 *  Kept beside the derived signature because a signature is not readable and a
 *  name is not addressable, and both questions get asked.
 *
 *  Named for what it IS — the interface a hole states — rather than for the
 *  word in its value. `MEANING_ATTR` read as a declaration of a pool meaning,
 *  and the doctrine ratchet believed it, correctly, on the name. */
export const INTERFACE_ATTR = 'data-hc-meaning'

/** THE TARGET: the signature that meaning derives to.
 *
 *  This is the addressable half — what a renderer matches candidates against,
 *  and what a search across domains asks for. It is DERIVED, never authored:
 *  the template stores the name, and the signature is resolved at compose time
 *  by whoever is composing. Storing the hex would freeze an address the
 *  registry is meant to own, and there is a standing rule against writing one
 *  into code at all. */
export const TARGET_ATTR = 'data-hc-target'

/** OPEN CLASSIFICATION, as ONE attribute value: `data-hc-mark="pinned quiet"`.
 *
 *  Marks are the extensible half of a layout — a new one costs no code here
 *  and no field on any record. They are a TOKEN SET, never a key/value bag,
 *  and never an attribute NAME: an attribute name supplied by data is how a
 *  record ends up writing `onclick`, and this file has no deny-list because
 *  it structurally needs none. Same carrier the hive already uses for
 *  classification (pheromone marks) and the same shape: folded, deduped,
 *  sorted, capped. */
export const MARK_ATTR = 'data-hc-mark'

/** As many marks as anything here will carry. Past this it is not a
 *  classification, it is a payload wearing one. */
const MAX_MARKS = 24

/** Variable prefix. One vocabulary for every layout; see the header. */
export const VAR_PREFIX = '--hc-layout-'

// ── THE FLEX CONFIGURATION ───────────────────────────────────────────────
//
// Five properties decide how a container arranges what is in it. They are
// carried as variables like everything else — `{ direction: 'column' }` — so a
// configuration is DATA, and the same editor that moves a gutter can move an
// alignment.
//
// ── BUT CONFIGURATION DOES NOT INHERIT, AND MEASUREMENTS DO ─────────────
//
// This is the one deliberate asymmetry in the model, and it is worth being
// exact about.
//
// A MEASUREMENT is a fact about the design: a gutter, a rail's width, an
// inset. Declaring it once at the top and letting it fall through is the whole
// reason the vocabulary is shared, and it is why a layout nested three deep
// arrives already dressed.
//
// A CONFIGURATION is a fact about THIS container's own axis. If `direction`
// inherited, a `stack` dropped into a `row` would silently become a row — and
// nesting a column inside a row is the entire point of nesting. So a container
// resolves its own configuration and writes it as a concrete value; nothing
// about it falls through.
//
// The vocabularies are closed. A value not on these lists is dropped and the
// default stands — default-deny, the same rule the rest of the file follows,
// and the reason no keyword here can carry anything into a style attribute.

const DIRECTIONS = ['row', 'column', 'row-reverse', 'column-reverse'] as const
const WRAPS = ['nowrap', 'wrap', 'wrap-reverse'] as const
const JUSTIFY = [
  'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly',
] as const
const ALIGN = ['stretch', 'flex-start', 'flex-end', 'center', 'baseline'] as const
const ALIGN_CONTENT = [
  'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around',
] as const

/** The five names a configuration is carried under, and what each may say. */
export const CONFIGURATION_AXES: readonly {
  readonly name: string
  readonly values: readonly string[]
}[] = Object.freeze([
  { name: 'direction', values: DIRECTIONS },
  { name: 'wrap', values: WRAPS },
  { name: 'justify', values: JUSTIFY },
  { name: 'align', values: ALIGN },
  { name: 'align-content', values: ALIGN_CONTENT },
])

/** How a container arranges what is in it, resolved. */
export interface FlexConfiguration {
  readonly direction: string
  readonly wrap: string
  readonly justify: string
  readonly align: string
  readonly alignContent: string
}

const pick = (
  vars: Readonly<Record<string, string>>,
  name: string,
  allowed: readonly string[],
  fallback: string,
): string => {
  const asked = String(vars[name] ?? '').trim()
  return allowed.includes(asked) ? asked : fallback
}

/**
 * The configuration a container reads, from its own variables, with the
 * template's `flow` supplying the defaults.
 *
 * `flow` is not a rival concept — it is shorthand for the two axes anybody
 * sets first. `row` means direction row and no wrapping; `column` turns it;
 * `wrap` is a row that wraps. Everything past that is a variable, and a
 * variable always wins.
 */
export function configurationOf(
  template: LayoutTemplate,
  vars: Readonly<Record<string, string>> = template.vars,
): FlexConfiguration {
  const direction = template.flow === 'column' ? 'column' : 'row'
  const wrap = template.flow === 'wrap' ? 'wrap' : 'nowrap'
  return {
    direction: pick(vars, 'direction', DIRECTIONS, direction),
    wrap: pick(vars, 'wrap', WRAPS, wrap),
    justify: pick(vars, 'justify', JUSTIFY, 'flex-start'),
    align: pick(vars, 'align', ALIGN, 'stretch'),
    alignContent: pick(vars, 'align-content', ALIGN_CONTENT, 'stretch'),
  }
}

// ── ROTATION ────────────────────────────────────────────────────────────
//
// TURNING A LAYOUT IS A QUARTER-TURN OF ITS MAIN AXIS, AND NOTHING ELSE.
//
// This is why the library draws every arrangement ONE way. `flex-direction`
// already spells the four quarters — `row` is the way it was drawn, and each
// value after it is one more quarter clockwise — so a turn is a single
// variable on a single level, minted like any other edit, inheriting nothing
// and cascading nowhere.
//
// NOTHING ABOUT A HOLE IS REWRITTEN ON THE WAY ROUND. A hole never states its
// cross axis (see `holeStyle`), so a `fixed` hole's `flex-basis` is a WIDTH in
// a row and a HEIGHT in a column from the same declaration; `gap` and
// `padding` are axis-agnostic already; `min-width:0` and `min-height:0` are
// both always present. The turned container is therefore laid out exactly as
// it would have been if it had been drawn that way in the first place — which
// is not a coincidence to be grateful for, it is the pay-off of the rule that
// a hole may not state its cross axis.
//
// The two things that DO change meaning are `justify` and `align`, and they
// change it because that is what they mean: they name the main and cross axes,
// and the axes have swapped. Flexbox's own semantics, stated, not worked
// around.
//
// The ORDER of this list is load-bearing — it IS the rotation — so it is the
// same list the vocabulary is checked against rather than a second copy that
// could be reordered by somebody tidying either one.

/** The four quarter-turns, clockwise from the way a layout is drawn. */
export const QUARTER_TURNS: readonly string[] = Object.freeze([...DIRECTIONS])

/** Which quarter a container stands at — 0 for the way it was drawn.
 *
 *  Resolved rather than read: a level that says nothing about its direction is
 *  at the quarter its flow implies, and that is the answer a turn has to start
 *  from or the first press does nothing visible. */
export function turnOf(
  template: LayoutTemplate,
  vars: Readonly<Record<string, string>> = template.vars,
): number {
  const at = QUARTER_TURNS.indexOf(configurationOf(template, vars).direction)
  return at < 0 ? 0 : at
}

/** The direction `quarters` turns on from where this container stands. Wraps
 *  in both senses, so turning back from the first quarter lands on the last. */
export function turnedDirection(
  template: LayoutTemplate,
  vars: Readonly<Record<string, string>> = template.vars,
  quarters = 1,
): string {
  const count = QUARTER_TURNS.length
  const at = (turnOf(template, vars) + Math.trunc(quarters)) % count
  return QUARTER_TURNS[(at + count) % count]
}

/** How a set of holes runs. `row` and `column` are single-axis; `wrap` is a
 *  row that lets a `band` hole break the line, which is the only thing the
 *  five-hole application shell needs that a plain row cannot express. */
export type LayoutFlow = 'row' | 'column' | 'wrap'

/** One hole in a layout.
 *
 *  `fixed` holes take their extent from `--hc-layout-<key>`; `fluid` holes take
 *  what is left, in proportion to `grow`. A hole never states a height in a
 *  row or a width in a column — the cross axis is always intrinsic, which is
 *  what lets any part fit any hole (division-assembly.ts states the same rule
 *  for the derived container, for the same reason). */
export interface LayoutHole {
  /** Designer-facing name: `left`, `middle`, `masthead`. Also the variable
   *  suffix, so `left` is sized by `--hc-layout-left`. */
  readonly key: string
  /** `fixed` — sized by its variable. `fluid` — takes the remainder. */
  readonly fill: 'fixed' | 'fluid'
  /** Share of the remainder, for `fluid` holes. Default 1. */
  readonly grow?: number
  /** Break the line and take the full cross-axis extent. `wrap` only — this
   *  is the masthead / footer band, and it is why `wrap` exists. */
  readonly band?: boolean
  /** This hole is where the CONTAINER'S OWN page goes. At most one per
   *  template. It gets no slot index, so it is not a member hole at all and
   *  member positions are unaffected by whether a template has one. */
  readonly self?: boolean

  /** THIS HOLE'S OWN VARIABLES — the open, extensible half.
   *
   *  Same shape and the same sanitiser as `LayoutTemplate.vars`, scoped to the
   *  hole: `{ align: 'center' }` is emitted as
   *  `--hc-layout-<key>-align: center`. Two of them are read by this file
   *  (`align`, `overflow`); every other name is simply DECLARED, and whatever
   *  is seated in the hole can read it — custom properties cross a declarative
   *  shadow boundary, so a part styles itself from the hole it is sitting in
   *  without the hole knowing anything about the part.
   *
   *  This is the extension point. A new layout property is a new variable
   *  name, not a new field and not a new code path. */
  readonly vars?: Readonly<Record<string, string>>

  /** Open classification for this hole. See MARK_ATTR. */
  readonly marks?: readonly string[]

  /** WHAT THIS HOLE IS FOR — a conventional name like `site:masthead`.
   *
   *  This is the interface, stated. The hole still names nobody: it says what
   *  belongs, and anything that declares the same meaning is a candidate. That
   *  is what lets somebody else's artifact, on somebody else's hive, fill a
   *  hole in a layout they have never seen.
   *
   *  SCOPED WITH A COLON, always. Conventional names are agreed on across
   *  hives that never coordinate, and a bare word is a word somebody else is
   *  already using for something else — the same reason every pool meaning in
   *  this codebase carries one. An unscoped meaning is dropped rather than
   *  guessed at. */
  readonly meaning?: string
}

/** A named layout. Content-addressed; bound by signature, never inlined. */
export interface LayoutTemplate {
  readonly kind: typeof LAYOUT_TEMPLATE_KIND
  readonly version: 1
  /** Stable slug. Two templates with the same name are the same template. */
  readonly name: string
  readonly flow: LayoutFlow
  readonly holes: readonly LayoutHole[]
  /** DEFAULTS for this template's variables, unprefixed keys with CSS-length
   *  values: `{ space: '0rem', padding: '1rem', left: '10rem' }`. Written once
   *  on the root container so every level below inherits them. */
  readonly vars: Readonly<Record<string, string>>
  /** Open classification for the container. See MARK_ATTR. */
  readonly marks?: readonly string[]
}

/** Fold a typed name the same way a relation name is folded, so "Fifty Fifty"
 *  and "sidebar" are one template rather than two. */
export const templateSlug = (name: string): string =>
  String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** A hole's name folded into a slug — it becomes a CSS custom property
 *  suffix, and an unescaped one would end the declaration. Authored names are
 *  FOLDED here (`My Rail` names the same hole as `my-rail`). */
const varSlug = (name: string): string =>
  String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** A variable name is only accepted if it ALREADY is a slug. Folding one here
 *  would quietly turn `bad;key` into `badkey` — a variable nobody wrote, on a
 *  hole nobody named. An override that names no hole is a mistake worth
 *  dropping, not one worth renaming. */
const varName = (name: string): string => {
  const text = String(name ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]*$/.test(text) ? text : ''
}

/** A CSS length, or nothing. Deliberately permissive about UNITS (`em`, `rem`,
 *  `%`, `px`, `ch`, `vw`, `fr`-less `calc()`) and strict about characters: a
 *  value goes into a style attribute, so `;` and `}` can never appear in one. */
const cssLength = (value: unknown): string | null => {
  const text = String(value ?? '').trim()
  if (!text || text.length > 64) return null
  if (/[;{}<>"']/.test(text)) return null
  if (!/^[-\w\s.,%()+*/]+$/.test(text)) return null
  return text
}

const attr = (value: string): string =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// ── the library ──────────────────────────────────────────────────────────
//
// SIX PRIMITIVES, AND THEY ARE DRAWN ONE WAY.
//
// There were twenty. Sixteen of them were another one turned, mirrored, or
// counted higher — `rows-two` was `split` on its side, `right-rail` was
// `left-rail` seen from the other end, `rows-four` was two `split`s. A palette
// of twenty is a wall you read; a palette of six is a set of parts you build
// out of, and building is the thing this window is for.
//
// So the library holds the arrangements that cannot be made out of the others:
//
//     ONE HOLE     single       the page, in a box of its own
//     TWO HOLES    split        two even shares
//                  rail         a measured strip, and the rest
//     THREE HOLES  thirds       three even shares
//                  bookends     a measured strip at each end, the rest between
//                  measure      a measured strip in the MIDDLE, the rest at
//                               each end — the dual of bookends, and the one
//                               shape neither turning nor nesting reaches
//
// THREE IS THE CEILING, and nesting is why. Four even shares is `split` with a
// `split` in each hole; a six-cell gallery is `thirds` with a turned `split`
// in each. Every one of those was in the library and every one of them cost a
// chip that said less than the gesture that replaces it. What is NOT reachable
// by nesting is a hole's own kind — fluid or fixed is a fact about the
// template, not a measurement — which is exactly why `rail`, `bookends` and
// `measure` are here and `two-thirds` is not: a proportion is a measurement,
// and the slider already moves it.
//
// ── ROTATION IS THE OTHER HALF OF "ONE WAY" ─────────────────────────────
//
// Every one of these is a ROW, and none of them needs a column twin, because
// turning a container is a quarter-turn of its main axis and flexbox already
// spells all four (see QUARTER_TURNS). Nothing about a hole has to be rewritten
// on the way round: a hole never states its cross axis, so a `fixed` hole's
// `flex-basis` is a WIDTH in a row and a HEIGHT in a column, by the same
// declaration. That is not a trick, it is the reason the cross axis was left
// unstated in the first place — and it is why `left-rail`, `right-rail`,
// `header-body` and `body-footer` are one template now.
//
// They are named for what they ARE, and for what stays true after the turn: a
// layout named for a SIDE describes something that stops being true the moment
// somebody turns it, exactly as a layout named for its starting proportions
// stops being true the moment somebody moves a variable. `head` and `tail` are
// ends of the main axis; `left` and `right` were not.
//
// EVERY ONE IS ONE-DIMENSIONAL, and that is the whole design. A flexbox
// container has a single axis; a page that needs two is a container with
// another container nested in one of its holes. So there is no `shell` here —
// a masthead over two rails over a footer is a turned `bookends` with a
// `bookends` in its middle. And there is no `wrap` here either: a wrapping row
// cannot give the remainder to one line, because `align-content: stretch`
// divides leftover space EQUALLY among lines, so the body would always draw at
// the height of its own content while the bands sat at their measure. It looks
// finished at exactly one size. `wrap` remains a flow a stored template may
// declare; nothing built in asks for it.

const BUILTINS: readonly LayoutTemplate[] = [
  // ── ONE HOLE ───────────────────────────────────────────────────────
  //
  // The page and nothing else, in a container of its own — which is what
  // gives it a padding and a place to be turned and nested.
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'single',
    flow: 'row',
    holes: [
      { key: 'body', fill: 'fluid', self: true },
    ],
    vars: {},
  },
  // ── TWO HOLES ──────────────────────────────────────────────────────
  //
  // Turned, `split` is two even rows and `rail` is a header, a footer, or a
  // side rail — four shapes each, from one drawing.
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'split',
    flow: 'row',
    holes: [
      { key: 'one', fill: 'fluid' },
      { key: 'two', fill: 'fluid' },
    ],
    vars: {},
  },
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'rail',
    flow: 'row',
    holes: [
      { key: 'rail', fill: 'fixed' },
      { key: 'body', fill: 'fluid', self: true },
    ],
    vars: { rail: '14rem' },
  },
  // ── THREE HOLES ────────────────────────────────────────────────────
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'thirds',
    flow: 'row',
    holes: [
      { key: 'one', fill: 'fluid' },
      { key: 'two', fill: 'fluid', self: true },
      { key: 'three', fill: 'fluid' },
    ],
    vars: {},
  },
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'bookends',
    flow: 'row',
    holes: [
      { key: 'head', fill: 'fixed' },
      { key: 'body', fill: 'fluid', self: true },
      { key: 'tail', fill: 'fixed' },
    ],
    vars: { head: '10rem', tail: '10rem' },
  },
  {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name: 'measure',
    flow: 'row',
    holes: [
      { key: 'before', fill: 'fluid' },
      { key: 'body', fill: 'fixed', self: true },
      { key: 'after', fill: 'fluid' },
    ],
    vars: { body: '42rem' },
  },
]

export const BUILTIN_LAYOUTS: readonly LayoutTemplate[] = Object.freeze(BUILTINS)

export const builtinLayout = (name: string): LayoutTemplate | null =>
  BUILTIN_LAYOUTS.find(t => t.name === templateSlug(name)) ?? null

// ── reading one back ─────────────────────────────────────────────────────

/**
 * Parse a stored template. Returns null for anything that is not one, so a
 * signature pointing at other bytes degrades to "no template bound" rather
 * than to a broken page.
 */
export function parseLayoutTemplate(raw: unknown): LayoutTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  if (source['kind'] !== LAYOUT_TEMPLATE_KIND) return null

  const name = templateSlug(String(source['name'] ?? ''))
  if (!name) return null

  const flow = source['flow']
  const known: readonly LayoutFlow[] = ['row', 'column', 'wrap']
  if (typeof flow !== 'string' || !known.includes(flow as LayoutFlow)) return null

  const rawHoles = Array.isArray(source['holes']) ? source['holes'] : []
  const holes: LayoutHole[] = []
  const seenKeys = new Set<string>()
  let selfTaken = false
  for (const entry of rawHoles) {
    if (!entry || typeof entry !== 'object') continue
    const hole = entry as Record<string, unknown>
    const key = varSlug(String(hole['key'] ?? ''))
    // A duplicate key would give two holes one variable, and the second would
    // silently resize the first.
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    const fill = hole['fill'] === 'fixed' ? 'fixed' : 'fluid'
    const grow = Number(hole['grow'])
    // At most one self hole: a container has one page.
    const isSelf = hole['self'] === true && !selfTaken
    if (isSelf) selfTaken = true
    const holeVars = sanitizeVars(hole['vars'])
    const holeMarks = sanitizeMarks(hole['marks'])
    holes.push({
      key,
      fill,
      ...(Number.isFinite(grow) && grow > 0 ? { grow } : {}),
      // Only where the line can break. The type says `wrap` only; a stored
      // record is data, not a type, and this is the one place that difference
      // can be enforced.
      ...(hole['band'] === true && flow === 'wrap' ? { band: true } : {}),
      ...(isSelf ? { self: true } : {}),
      ...(Object.keys(holeVars).length ? { vars: holeVars } : {}),
      ...(holeMarks.length ? { marks: holeMarks } : {}),
      ...(sanitizeMeaning(hole['meaning']) ? { meaning: sanitizeMeaning(hole['meaning']) } : {}),
    })
  }
  if (holes.length === 0) return null

  return {
    kind: LAYOUT_TEMPLATE_KIND,
    version: 1,
    name,
    flow: flow as LayoutFlow,
    holes,
    vars: sanitizeVars(source['vars']),
    ...(sanitizeMarks(source['marks']).length
      ? { marks: sanitizeMarks(source['marks']) } : {}),
  }
}

/** Fold a token set: slug each, drop empties, dedupe, sort, cap.
 *
 *  Folded rather than dropped, unlike a variable NAME — a mark is a label, not
 *  an address, so `Full Bleed` and `full-bleed` are the same classification and
 *  turning one into the other loses nothing. Sorted so two templates carrying
 *  the same marks in a different order mint the same signature. */
export function sanitizeMarks(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const entry of raw) {
    const slug = varSlug(String(entry ?? ''))
    if (slug) out.add(slug)
  }
  return Object.freeze([...out].sort().slice(0, MAX_MARKS))
}

/** A conventional name, or nothing.
 *
 *  `<scope>:<name>`, both slugs. The colon is not decoration: it is what keeps
 *  a conventional name from colliding with everything else that is named by a
 *  bare word, and it is the same rule the pool meanings follow. Folded, so
 *  `Site: Masthead` and `site:masthead` are one meaning rather than two. */
export function sanitizeMeaning(raw: unknown): string {
  const text = String(raw ?? '').trim().toLowerCase()
  const at = text.indexOf(':')
  if (at <= 0) return ''
  const scope = varSlug(text.slice(0, at))
  const name = varSlug(text.slice(at + 1))
  return scope && name ? `${scope}:${name}` : ''
}

/** Keep only variables that are a slug pointing at a CSS length. Everything
 *  else is dropped rather than escaped — a template is authored, and a value
 *  nobody can express is a value nobody meant. */
export function sanitizeVars(raw: unknown): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const name = varName(key)
      const length = cssLength(value)
      if (name && length) out[name] = length
    }
  }
  return Object.freeze(out)
}

/** The record to store. Same shape in, same signature out — the dedup that
 *  makes N bindings N references. */
export const layoutTemplateRecord = (template: LayoutTemplate): LayoutTemplate => ({
  kind: LAYOUT_TEMPLATE_KIND,
  version: 1,
  name: template.name,
  flow: template.flow,
  holes: template.holes,
  vars: template.vars,
  ...(template.marks?.length ? { marks: sanitizeMarks(template.marks) } : {}),
})

// ── holes ────────────────────────────────────────────────────────────────

/** The holes a MEMBER can seat into, in order. The self hole is excluded, so
 *  member positions never shift because a template does or does not have one. */
export const memberHoles = (template: LayoutTemplate): readonly LayoutHole[] =>
  template.holes.filter(h => !h.self)

/** Slot index of a named hole, or -1 when it is not a member hole. */
export const holeIndex = (template: LayoutTemplate, key: string): number =>
  memberHoles(template).findIndex(h => h.key === varSlug(key))

/** Name of member-hole `index`, or '' past the end. */
export const holeKeyAt = (template: LayoutTemplate, index: number): string =>
  memberHoles(template)[index]?.key ?? ''

/** Every variable this template reads, in declaration order: the two universal
 *  ones, then one per fixed hole. What the options inspector renders. */
export function variablesOf(template: LayoutTemplate): readonly string[] {
  const out = ['space', 'padding']
  for (const hole of template.holes) {
    // A FIXED hole is sized by its variable, so it always has one. A FLUID
    // hole takes the remainder and needs none — unless the template gave it a
    // basis, which is what makes a gallery cell claim a share and wrap. Both
    // are the same question: does this hole have a measurement to move?
    const measured = hole.fill === 'fixed' || template.vars[hole.key] !== undefined
    if (measured && !out.includes(hole.key)) out.push(hole.key)
  }
  return out
}

/**
 * The measurements a layout wears in a MINIATURE — a palette chip.
 *
 * NOT a special case, and not a CSS override: the same layout, given
 * measurements suited to the space it is in. A rail declared at 10rem is a
 * rail declared at 10rem — in a 34-pixel chip that is the whole chip three
 * times over, so the chip asks for the rail as a SHARE instead.
 *
 * That is the point of the variables being the design. A layout that only
 * reads correctly at the size its author happened to be looking at is not
 * really programmed, and the chip is the smallest honest test of that.
 */
export function miniatureVars(template: LayoutTemplate): Readonly<Record<string, string>> {
  // `overflow: hidden` is the block axis. `max-width:100%` clamps every width
  // case, but a container chain that is auto-height by doctrine has no
  // percentage to clamp against — so the one box with a definite height, the
  // chip, says so.
  const vars: Record<string, string> = { space: '1px', padding: '0rem', overflow: 'hidden' }
  for (const hole of template.holes) {
    // Fluid holes take the remainder and need no measurement at any scale.
    if (hole.fill === 'fixed') vars[hole.key] = '22%'
  }
  return vars
}

// ── the container ────────────────────────────────────────────────────────

/** One hole's flex declaration. The cross axis is never stated — see the
 *  header on why a hole that fixes both axes stops accepting parts.
 *
 *  `min-width:0` / `min-height:0` are load-bearing on every flex track: without
 *  them one long unbroken word in a part forces its track wider than its share
 *  and the layout stops being the layout.
 *
 *  ── A HOLE ALWAYS FITS THE SPACE IT IS ALLOTTED ───────────────────────
 *
 *  A fixed hole holds its measure UNTIL THE MEASURE DOES NOT FIT, and then it
 *  gives way. `flex-shrink: 1`, not 0.
 *
 *  Zero was the obvious reading of "fixed" and it is wrong at every scale but
 *  one. Two 10rem rails in a 34px chip overflow by 286px; the same two rails
 *  in a hole 8rem wide overflow by half their width. The layout stops being a
 *  layout and becomes a thing that spills — and it does so silently, because
 *  flex overflow does not clip. An arrangement that only works at the size its
 *  author happened to be looking at is not an arrangement.
 *
 *  Shrinking is proportional to the basis, so two equal rails give way
 *  equally and a rail twice the width gives up twice as much. That is the
 *  behaviour anyone would draw on paper.
 *
 *  A BAND is the same rule on the other axis: its extent is a height (or a
 *  width in a column), and `max-height:100%` clamps it to the line it was
 *  given. Where the container has no definite size on that axis — a page that
 *  grows with its content — the clamp resolves to nothing, which is exactly
 *  right: there is no allotted space to exceed. */
function holeStyle(template: LayoutTemplate, hole: LayoutHole): string {
  // `0px`, not nothing: an undeclared variable would leave `flex-basis` at
  // `auto`, and a "fixed" hole would silently size itself to its content.
  const extent = `var(${VAR_PREFIX}${hole.key},0px)`
  const bounds = 'min-width:0;min-height:0'

  // THE OPEN PROPERTIES. Two names this file resolves, each falling back to
  // the CSS default so a hole that says nothing behaves exactly as it did
  // before they existed. Everything else in `hole.vars` is declared and left
  // for whatever is seated here to read.
  const scope = `${VAR_PREFIX}${hole.key}-`
  const open = `align-self:var(${scope}align,auto);overflow:var(${scope}overflow,visible)`
  const declared = Object.entries(sanitizeVars(hole.vars))
    .map(([name, value]) => `${scope}${name}:${value}`)
    .join(';')
  const own = `${open}${declared ? `;${declared}` : ''}`

  // A BAND ONLY EXISTS WHERE THE LINE CAN BREAK. `flex-basis: 100%` of the
  // main axis is exact in `wrap`, where the band is alone on its line — and an
  // unconditional overflow anywhere else, because in a nowrap row it claims
  // the entire width and every sibling is added on top of it. A band declared
  // on a single-axis flow falls through to the ordinary rules below, which
  // already fit.
  if (hole.band && template.flow === 'wrap') {
    return `flex:0 1 100%;${sizeOnCross(extent)};${bounds};${own}`
  }
  if (hole.fill === 'fixed') return `flex:0 1 ${extent};${bounds};${own}`
  return `flex:${hole.grow ?? 1} 1 var(${VAR_PREFIX}${hole.key},0);${bounds};${own}`
}

/** A band breaks the line, so its own extent is on the OTHER axis from the
 *  flow. Bands exist only in `wrap`, and `wrap` is a ROW that wraps — so the
 *  cross axis is always vertical and the extent is always a height. Clamped to
 *  the line it was given: a 3.5rem masthead in a 22px box is still a masthead,
 *  it is just a small one. */
const sizeOnCross = (extent: string): string =>
  `height:${extent};max-height:100%`

/** The variable declarations for a container. Only what it OVERRIDES, so
 *  everything else keeps falling through from above — the root passes the
 *  template's own defaults, a nested container passes only its changes. */
export function varDeclarations(vars: Readonly<Record<string, string>>): string {
  const clean = sanitizeVars(vars)
  return Object.entries(clean)
    // The configuration axes are RESOLVED into concrete properties by
    // `containerStyle` and must not also be published as custom properties:
    // a custom property inherits, and a `--hc-layout-direction` sitting on a
    // container would fall through to everything nested inside it. Nothing
    // reads them, so publishing them would be inheritable noise at best and a
    // trap for the next person at worst.
    .filter(([key]) => !CONFIGURATION_NAMES.has(key))
    .map(([key, value]) => `${VAR_PREFIX}${key}:${value}`)
    .join(';')
}

/** Only the configuration entries of a variable bag — what a level says about
 *  its own axis, with every measurement left behind. */
export function configurationVarsOf(
  vars: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const axis of CONFIGURATION_AXES) {
    const value = String(vars[axis.name] ?? '')
    if (axis.values.includes(value)) out[axis.name] = value
  }
  return out
}

/** The axis names, for the one place that has to exclude them. */
const CONFIGURATION_NAMES: ReadonlySet<string> =
  new Set(CONFIGURATION_AXES.map(axis => axis.name))

/**
 * The container HTML for a template.
 *
 * `vars` is what THIS container declares. Pass the template's own defaults at
 * the root and only the overrides on a nested one; anything absent inherits.
 *
 * Member holes carry `data-hc-slot="k"` so `assemble()` seats into them by the
 * same positional rule the derived container uses — a template changes what a
 * container LOOKS like, never how seating works.
 */
function containerStyle(
  template: LayoutTemplate,
  declarations: string,
  vars: Readonly<Record<string, string>>,
): string {
  // RESOLVED, not `var(...)`: a configuration is a fact about this container's
  // own axis and must not fall through to what is nested inside it. See the
  // header on CONFIGURATION_AXES.
  const flex = configurationOf(template, vars)
  return [
    'display:flex',
    `flex-direction:${flex.direction}`,
    `flex-wrap:${flex.wrap}`,
    `justify-content:${flex.justify}`,
    `align-items:${flex.align}`,
    `align-content:${flex.alignContent}`,
    // Fall back to 0 rather than to a guess: a container whose ancestors say
    // nothing about spacing should sit flush, not at some default this file
    // invented.
    `gap:var(${VAR_PREFIX}space,0)`,
    `padding:var(${VAR_PREFIX}padding,0)`,
    // THE CONTAINER IS ITSELF A BOX THAT MUST FIT. Every rule above is about
    // the holes; without these the container is the thing that overflows, and
    // it does so at every depth of nesting.
    //
    // `max-width:100%` resolves against any parent, because a width in normal
    // flow is always definite — so a container can never be wider than its
    // allotment however deep it sits. There is no percentage equivalent on the
    // block axis while the chain is auto-height (which is doctrine: intrinsic
    // height, everywhere), so the escape hatch there is `overflow`, declared
    // as a variable and defaulting to exactly what it did before. A miniature
    // sets it to `hidden`; a page leaves it alone.
    'min-width:0',
    'min-height:0',
    'max-width:100%',
    `overflow:var(${VAR_PREFIX}overflow,visible)`,
    'box-sizing:border-box',
    declarations,
  ].filter(Boolean).join(';')
}

export function templateContainer(
  template: LayoutTemplate,
  vars?: Readonly<Record<string, string>>,
  targets?: TargetResolver,
): string {
  const own = vars ?? template.vars
  const wrap = containerStyle(template, varDeclarations(own), own)

  let index = 0
  const holes = template.holes.map(hole => {
    const style = holeStyle(template, hole)
    const named = `${HOLE_ATTR}="${attr(hole.key)}" ${behaviourAttrs(hole)}`
      + meaningAttrs(hole, targets)
    if (hole.self) return `<div ${named} ${SELF_ATTR} style="${style}"></div>`
    return `<div ${SLOT_ATTR}="${index++}" ${named} style="${style}"></div>`
  })

  return `<div data-hc-container="${attr(template.name)}"${marksAttr(template.marks)}`
    + ` style="${wrap}">${holes.join('')}</div>`
}

// ── nesting ──────────────────────────────────────────────────────────────
//
// A LAYOUT INSIDE A LAYOUT IS STILL ONE DESIGN.
//
// Dropping a layout into a hole must work whether or not anything is sitting
// in that hole — otherwise the arrangement can only be built in the order the
// content happened to arrive, and "design the page, then fill it" is not
// available. So nesting does NOT go through the tile in the hole: it is part
// of the container's own design and lives on the container's own mark, as a
// tree.
//
// The tiles are unaffected. They still seat by position into the LEAF holes,
// numbered in document order — which is the only numbering that survives
// somebody nesting a layout three levels down, because it is read off the
// finished arrangement rather than off any one template's hole list.
//
// A nested layout's `self` flag is ignored. There is one page here, and it
// belongs to the container; a second self hole would be a hole claiming a page
// that does not exist.

/** One level of a nested arrangement. */
export interface LayoutNode {
  readonly template: LayoutTemplate
  /** What THIS level declares. The root passes the merged defaults; a nested
   *  level passes only its own changes, so everything else still inherits. */
  readonly vars: Readonly<Record<string, string>>
  /** Layouts nested in this level's holes, by hole KEY. Keyed by name rather
   *  than index so a template gaining a hole does not silently move somebody
   *  else's nested layout into a different one. */
  readonly nested: Readonly<Record<string, LayoutNode>>
}

/** A hole that nothing is nested in — where content actually goes. */
export interface LeafHole {
  /** Seating position: what a member's mark carries. Document order. */
  readonly index: number
  readonly key: string
  /** Hole keys from the root, so the designer can address this exact hole
   *  without counting. */
  readonly path: readonly string[]
  readonly fill: 'fixed' | 'fluid'
  readonly band: boolean
  /** What this hole is for, if it says. */
  readonly meaning?: string
}

/** Attribute carrying a hole's path from the root — `left/middle`. The empty
 *  string is a hole on the root itself. */
export const PATH_ATTR = 'data-hc-path'

/**
 * Resolves a conventional name to the signature it addresses.
 *
 * Supplied by the caller, never computed here: deriving a signature needs the
 * store and an await, and this module is pure so that the same function draws
 * a container at publish time, in the browser, and in a test. A resolver that
 * knows nothing simply returns nothing, and the hole keeps its name and gets
 * no target — which is a hole nobody can fill yet, not a broken one.
 */
export type TargetResolver = (meaning: string) => string | undefined

/** Every conventional name a template mentions, so a caller can resolve them
 *  all in one pass before composing. */
export const meaningsOf = (template: LayoutTemplate): readonly string[] =>
  [...new Set(template.holes.map(hole => hole.meaning).filter((m): m is string => !!m))]

/** Every conventional name an ARRANGEMENT mentions, to any depth. */
export function meaningsIn(node: LayoutNode, depth = 0): readonly string[] {
  if (depth > 16) return []
  const out = new Set<string>(meaningsOf(node.template))
  for (const child of Object.values(node.nested)) {
    for (const meaning of meaningsIn(child, depth + 1)) out.add(meaning)
  }
  return [...out]
}

/** The interface a hole states: its name, and the address that name derives
 *  to. Absent when the hole is for nothing in particular. */
const meaningAttrs = (hole: LayoutHole, targets?: TargetResolver): string => {
  if (!hole.meaning) return ''
  const target = targets?.(hole.meaning)
  return ` ${INTERFACE_ATTR}="${attr(hole.meaning)}"`
    + (target ? ` ${TARGET_ATTR}="${attr(target)}"` : '')
}

/** What a hole DOES, as attributes. See FILL_ATTR and MARK_ATTR.
 *
 *  Every attribute NAME here is a constant in this file. The only variable
 *  part is a value, and it goes through `attr()`. That is the whole safety
 *  argument, and it is why no deny-list of `on*` handlers is needed. */
const behaviourAttrs = (hole: LayoutHole): string =>
  `${FILL_ATTR}="${hole.fill}"${hole.band ? ` ${BAND_ATTR}` : ''}`
  + marksAttr(hole.marks)

/** A token set as one attribute value, or nothing at all. */
const marksAttr = (marks: readonly string[] | undefined): string => {
  const clean = sanitizeMarks(marks)
  return clean.length ? ` ${MARK_ATTR}="${attr(clean.join(' '))}"` : ''
}

export const nodeOf = (
  template: LayoutTemplate,
  vars?: Readonly<Record<string, string>>,
  nested?: Readonly<Record<string, LayoutNode>>,
): LayoutNode => ({
  template,
  vars: sanitizeVars(vars ?? template.vars),
  nested: nested ?? {},
})

/**
 * The arrangement with `child` put into (or, with null, taken out of) the hole
 * at `path`.
 *
 * Pure tree surgery: no store, no signatures, no IoC. Minting happens after —
 * layout-piece.ts walks the result bottom-up — which keeps "what the
 * participant just did" and "what that costs to store" in separate functions
 * that can each be wrong on their own.
 *
 * A path through a hole nothing is nested in is refused rather than created:
 * you cannot drop into a hole that is not on the screen, so a path that names
 * one is a bug in the caller, and inventing the levels to make it valid would
 * hide it.
 */
export function withNodeAt(
  root: LayoutNode,
  path: readonly string[],
  child: LayoutNode | null,
): LayoutNode {
  if (path.length === 0) return child ?? root
  const [head, ...rest] = path
  const nested: Record<string, LayoutNode> = { ...root.nested }
  if (rest.length === 0) {
    if (child) nested[head] = child
    else delete nested[head]
  } else {
    const existing = nested[head]
    if (!existing) return root
    nested[head] = withNodeAt(existing, rest, child)
  }
  return { ...root, nested }
}

/** The arrangement with one variable set on the level at `path`. */
export function withVarAt(
  root: LayoutNode,
  path: readonly string[],
  name: string,
  value: string,
): LayoutNode {
  const clean = sanitizeVars({ [name]: value })
  if (!Object.keys(clean).length) return root
  if (path.length === 0) return { ...root, vars: { ...root.vars, ...clean } }
  const [head, ...rest] = path
  const existing = root.nested[head]
  if (!existing) return root
  return {
    ...root,
    nested: { ...root.nested, [head]: withVarAt(existing, rest, name, value) },
  }
}

/** The node at `path`, or null when the path names no nested layout. */
export function nodeAt(root: LayoutNode, path: readonly string[]): LayoutNode | null {
  let node: LayoutNode | null = root
  for (const key of path) {
    node = node?.nested[key] ?? null
    if (!node) return null
  }
  return node
}

/**
 * The whole arrangement, as one container.
 *
 * Leaf holes are numbered in document order, depth first — a hole with a
 * layout nested in it is not a seating position at all, its own leaves are.
 * That is what makes the numbering stable under nesting: it describes the
 * finished arrangement, which is the thing a member is seated into.
 */
export function composeLayout(root: LayoutNode, targets?: TargetResolver): {
  readonly html: string
  readonly leaves: readonly LeafHole[]
} {
  const leaves: LeafHole[] = []

  const walk = (node: LayoutNode, path: readonly string[], depth: number): string => {
    const declarations = varDeclarations(node.vars)
    const wrap = containerStyle(node.template, declarations, node.vars)
    const holes = node.template.holes.map(hole => {
      const here = [...path, hole.key]
      const style = holeStyle(node.template, hole)
      const named = `${HOLE_ATTR}="${attr(hole.key)}" ${PATH_ATTR}="${attr(here.join('/'))}"`
        + ` ${behaviourAttrs(hole)}` + meaningAttrs(hole, targets)
      const child = node.nested[hole.key]
      if (child) {
        return `<div ${named} style="${style}">${walk(child, here, depth + 1)}</div>`
      }
      // Only the ROOT has a page, so only the root's self hole is one.
      if (hole.self && depth === 0) {
        return `<div ${named} ${SELF_ATTR} style="${style}"></div>`
      }
      const index = leaves.length
      leaves.push({
        index, key: hole.key, path: here, fill: hole.fill, band: hole.band === true,
        ...(hole.meaning ? { meaning: hole.meaning } : {}),
      })
      return `<div ${SLOT_ATTR}="${index}" ${named} style="${style}"></div>`
    })
    return `<div data-hc-container="${attr(node.template.name)}"${marksAttr(node.template.marks)}`
      + ` style="${wrap}">${holes.join('')}</div>`
  }

  return { html: walk(root, [], 0), leaves }
}

/**
 * Seat the container's OWN page into its self hole.
 *
 * A container bound to a template keeps its page — rule 11 says the whole is
 * complete on its own, and swapping its page for a frame of empty boxes would
 * break that on the way in. The self hole is where it goes; a template without
 * one composes the members around a container whose page is not shown, which
 * is a legitimate design (a pure index page) and never an accident, because
 * declaring the hole is one flag.
 *
 * Left deliberately separate from `assemble()`: that function seats MEMBERS by
 * index, and the whole is not one of its own members.
 */
export function seatSelf(containerHtml: string, ownHtml: string): string {
  const source = String(containerHtml ?? '')
  if (!ownHtml) return source
  const hole = new RegExp(
    `(<([a-zA-Z][\\w-]*)([^>]*\\s${SELF_ATTR}[^>]*)>)\\s*(</\\2>)`,
  )
  return source.replace(hole, (whole, open: string, _tag: string, _attrs: string, close: string) =>
    `${open}${ownHtml}${close}`)
}
