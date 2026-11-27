// recipe/recipe-post.drone.ts
//
// THE POST BEE (documentation/open-entry-pools.md, "The page a phone sees").
// A leader shows a code; a phone opens the leader's page with
// `#post=<O>~<nonce>`; the shell announces the code (`entries:code`,
// hypercomb-shared core/invite-capture.ts) and leaves it in the address bar,
// so a reload comes back here. This bee is asleep until that announcement:
// on a page with an arrival plan only the planned bees load, so it is woken
// by the code and never by the plan (essentials scripts/passive-queen.ts
// effectSleeper; its spec holds this file to the sleeper's shape). It takes
// the code from the announcement, never from the address bar, and the same
// code announced again (popstate and hashchange both fire) is nothing new.
//
// WHAT IT DOES, IN ORDER
//   1. reads the opening record at the page's own origin, and from it and the
//      code works out the pool's address A and its name H (open-entries.ts);
//   2. asks the host first: the pool's listing says open, closed, expired, or
//      nothing, and the page says which in a plain sentence before anyone types;
//   3. open: the form (recipe-post.ts), drawn from the pool's template, and
//      when it ends. Closed: what was posted. Expired or unknown: the sentence;
//   4. one press signs the entry with a key made in memory for this page load
//      (never the shell's signer, never stored) and PUTs it at this origin,
//      the one write a visitor page may make, stamped with the host's time;
//   5. says where it went, or the host's own words;
//   6. under the form, what has been posted, read with the same reader, and
//      any of it opened in the read-along. The person's own entry can be
//      changed and taken back while this tab lives.
//
// WHAT THE PERSON HAS POSTED IS READ BACK FROM THE HOST. After every read of
// the pool, the members this page load's key signed say how many changes are
// spent, and the newest on the person's own entry page says whether it stands
// or was taken back. So a post whose answer was lost on the way (the host kept
// it, the phone never heard) still counts, and can still be taken back.
//
// Closing the page lets the code go: the same code announced again opens the
// form again. A record that did not arrive because the host did not answer is
// said as that, never as a code this host does not know, and the code is let go
// so the next announcement asks again.
//
// It acts only on a published visitor page: a full hive handed someone else's
// code is not in this change. The page never joins the room, opens no socket,
// and holds no secret but the code.

import { Drone, EffectBus, I18N_IOC_KEY, get, type I18nProvider, type PostCode } from '@hypercomb/core'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { postEntryMember, type OpenEntriesDeps } from '../pools/open-entries-flows.js'
import {
  ENTRY_LIMITS,
  entryPoolAddress,
  entryPoolName,
  entryRoomLeft,
  newEntryPage,
  parseEntryRecord,
  readEntryAtom,
  readEntryAtomAnswer,
  readEntryListing,
  readEntryPool,
  type EntryMember,
  type EntryOpeningRecord,
  type EntryPoolPath,
  type EntryPoolRead,
  type EntryReadDeps,
} from '../pools/open-entries.js'
import { isPublishedVisitorShell } from '../sharing/behavior-enablement.js'
import { fetchWithDeadline } from '../sharing/bounded-fetch.js'
import { DEFAULT_RECIPE_TEMPLATES } from './recipe-defaults.js'
import { RECIPE_ENTRY_MEANING, openRecipeEntry, postedRecipeOffers, type RecipeEntryOffer } from './recipe-entries.js'
import {
  RECIPE_POST_CHANGES,
  recipePostChanges,
  recipePostDocument,
  recipePostEnds,
  recipePostPage,
  recipePostRecipe,
  type RecipePostPageHandle,
  type RecipePostStanding,
} from './recipe-post.js'
import { RECIPE_LIMITS, parseRecipeTemplate, recipeBytes, type RecipeTemplate } from './recipe-template.js'

/** The keymap hold's owner while the page is up. */
const OWNER = 'recipe-post'
const HOST_TIMEOUT_MS = 8_000
const SIG = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{32}$/

/** Every external this bee touches. Each optional: the live one stands in for any left out. */
export interface RecipePostDeps {
  /** The page's own origin: where the pool is read and posted. */
  origin?(): string
  /** Is this a published visitor page? Only there does the bee act. */
  visitor?(): boolean
  /** A fetch with a deadline. */
  fetch?(url: string, init: RequestInit): Promise<Response>
  /** Milliseconds on this device's clock. */
  now?(): number
  /** The key this page load signs with. */
  newSecretKey?(): Uint8Array
  /** A fresh entry's page. */
  newPage?(): string
  /** Where the page is mounted. */
  mount?(): HTMLElement
}

/** The person's own entry in one pool, for as long as this tab lives. `at`: the stamp of its newest member. */
type Mine = { page: string; used: number; standing: RecipePostStanding; name: string; title: string; at: number }

/** One code being shown. */
type Session = {
  key: string
  code: PostCode
  origin: string
  page: RecipePostPageHandle
  record: EntryOpeningRecord | null
  path: EntryPoolPath | null
  /** H. */
  pool: string
  template: RecipeTemplate | null
  templateBytes: Uint8Array | null
  read: EntryPoolRead | null
  offset: number
  offers: Map<string, RecipeEntryOffer>
  busy: boolean
  gone: boolean
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const localeOf = (): string => {
  try { return get<I18nProvider>(I18N_IOC_KEY)?.locale || document.documentElement.lang || '' } catch { return '' }
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const oneLine = (text: string): string => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200)

export class RecipePostDrone extends Drone {
  /** THE EFFECT THAT WAKES THIS BEE: the shell's announcement of a code. The
   *  bus replays it to the bee when it loads (scripts/passive-queen.ts). */
  readonly wakesOn: readonly string[] = ['entries:code']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'The page a phone posts from: when a leader\'s code opens their page, asks the host about the pool, draws the form from its template, posts the entry with a key made for this page load, and shows what has been posted.'

  protected override listens: string[] = ['entries:code']
  protected override emits: string[] = ['keymap:hold', 'keymap:release']

  readonly #deps: RecipePostDeps
  #initialized = false
  /** The code last taken: the same one again is nothing new. */
  #code = ''
  #session: Session | null = null
  /** This page load's key, made in memory the first time it is needed and never stored. */
  #secret: Uint8Array | null = null
  #pubkey = ''
  /** The person's own entry, by pool. */
  readonly #mine = new Map<string, Mine>()

  constructor(deps: RecipePostDeps = {}) {
    super()
    this.#deps = deps
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    this.onEffect<PostCode>('entries:code', code => { void this.#take(code) })
  }

  protected override dispose(): void {
    this.#end()
  }

  // ── the deps, live where none was given ──────────────────────────────────

  #origin(): string { return this.#deps.origin?.() ?? location.origin }
  #now(): number { return (this.#deps.now ?? Date.now)() }
  #fetch(url: string, init: RequestInit): Promise<Response> {
    return this.#deps.fetch ? this.#deps.fetch(url, init) : fetchWithDeadline(url, init, { timeoutMs: HOST_TIMEOUT_MS })
  }
  #readDeps(): EntryReadDeps { return { fetch: (url, init) => this.#fetch(url, init), now: () => this.#now() } }
  #postDeps(): OpenEntriesDeps {
    return {
      now: () => this.#now(),
      listing: path => readEntryListing(path, this.#readDeps()),
      putMember: async (url, bytes) => {
        try {
          const response = await this.#fetch(url, { method: 'PUT', body: exact(bytes), credentials: 'omit' })
          const said = response.headers.get('X-Reason') ?? await response.text().catch(() => '')
          return { status: response.status, said: oneLine(said) }
        } catch { return { said: '' } }
      },
    }
  }
  #key(): Uint8Array {
    if (!this.#secret) {
      this.#secret = (this.#deps.newSecretKey ?? generateSecretKey)()
      this.#pubkey = getPublicKey(this.#secret)
    }
    return this.#secret
  }

  // ── a code arrives ───────────────────────────────────────────────────────

  async #take(code: PostCode | undefined): Promise<void> {
    const record = String(code?.record ?? '')
    const nonce = String(code?.nonce ?? '')
    if (!SIG.test(record) || !NONCE.test(nonce)) return
    const key = `${record}~${nonce}`
    if (key === this.#code) return
    const visitor = this.#deps.visitor ?? (() => isPublishedVisitorShell() || (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true)
    if (!visitor()) return
    this.#code = key
    this.#end()
    // Made before anything is asked, so the poster's own rows are marked theirs from the first read.
    this.#key()
    const session: Session = {
      key, code: { record, nonce }, origin: this.#origin(),
      page: recipePostPage({
        say: t,
        title: t('recipe.post.title', 'Post an entry'),
        // The person closed it: the code is let go, so the same code announced again opens the form again.
        onClose: () => { this.#code = ''; this.#end() },
        onInput: () => this.#measure(session),
        onPost: () => { void this.#post(session, false) },
        onTakeBack: () => { void this.#post(session, true) },
        onOpen: sig => { void this.#open(session, sig) },
      }),
      record: null, path: null, pool: '', template: null, templateBytes: null, read: null,
      offset: 0, offers: new Map(), busy: false, gone: false,
    }
    this.#session = session
    ;(this.#deps.mount?.() ?? document.body).appendChild(session.page.element)
    EffectBus.emitTransient('keymap:hold', { reason: OWNER })
    await this.#begin(session)
  }

  /** Steps 1 and 2: the record, the names, then the host's word on the pool. */
  async #begin(session: Session): Promise<void> {
    session.page.setState(t('recipe.post.state.asking', 'Asking this host about the code.'))
    const answer = await readEntryAtomAnswer(session.origin, session.code.record, ENTRY_LIMITS.recordBytes, this.#readDeps())
    if (session.gone) return
    if (!answer.bytes && !answer.reached) {
      // Not an answer about the code: the host did not answer. The next announcement of this code asks again.
      if (this.#session === session) this.#code = ''
      session.page.setState(t('recipe.post.state.record-unreachable', 'This host did not answer. Try again in a moment.'))
      session.page.setForm(null)
      session.page.setPosted(null)
      return
    }
    const parsed = answer.bytes ? await parseEntryRecord(answer.bytes, session.code.record) : null
    if (session.gone) return
    if (!parsed?.ok) { this.#unknown(session); return }
    const record = parsed.record
    if (record.meaning !== RECIPE_ENTRY_MEANING) {
      session.page.setState(t('recipe.post.state.meaning', 'This code is for something this page cannot take.'))
      return
    }
    const address = await entryPoolAddress(session.code.record, session.code.nonce)
    const pool = address ? await entryPoolName(address, record.by, record.until) : ''
    if (!pool) { this.#unknown(session); return }
    session.record = record
    session.path = { page: session.origin, address, by: record.by, until: record.until }
    session.pool = pool
    if (!this.#mine.has(pool)) this.#mine.set(pool, { page: (this.#deps.newPage ?? newEntryPage)(), used: 0, standing: 'none', name: '', title: '', at: 0 })
    session.page.setTitle(record.title)
    await this.#refresh(session)
  }

  #unknown(session: Session): void {
    session.page.setState(t('recipe.post.state.unknown', 'This host is not taking posts for this code.'))
    session.page.setForm(null)
    session.page.setPosted(null)
  }

  /** Step 3, and again after every post: ask the host, then draw what it said. */
  async #refresh(session: Session): Promise<void> {
    const { path, record } = session
    if (!path || !record) return
    const read = await readEntryPool(path, session.pool, this.#readDeps())
    if (session.gone) return
    session.read = read
    session.offset = read.offset
    const page = session.page
    if (!read.reached) {
      page.setState(t('recipe.post.state.unreachable', 'The host did not answer. Reload the page to try again.'))
      page.setForm(null)
      page.setPosted(null)
      return
    }
    if (read.state === null) { this.#unknown(session); return }
    if (read.state === 'open' || read.state === 'closed') this.#derive(session, read)
    if (read.state === 'expired') {
      page.setState(t('recipe.post.state.expired', 'This one has expired.'))
      page.setForm(null)
      page.setPosted(null)
      return
    }
    if (read.state === 'closed') {
      page.setState(t('recipe.post.state.closed', 'This one is closed. Here is what was posted.'))
      page.setForm(null)
    } else {
      const ends = t('recipe.post.state.ends', 'Open until {when}.', { when: recipePostEnds(record.until, localeOf()) })
      const template = await this.#template(session)
      if (session.gone) return
      if (!template) {
        page.setState(t('recipe.post.state.no-form', 'This one is open, but its form did not arrive. Reload the page to try again.'), ends)
        page.setForm(null)
      } else {
        page.setState(t('recipe.post.state.open', 'This one is open. Write your entry below.'), ends)
        page.setForm(template)
      }
    }
    await this.#list(session, read)
    this.#measure(session)
  }

  /**
   * What the person has posted, as the host holds it: the members this page
   * load's key signed spend the changes (the most of what was counted here and
   * what the host lists), and the newest on the person's entry page decides
   * whether it stands, with its name and title, unless this page posted
   * something newer than the host has listed yet.
   */
  #derive(session: Session, read: EntryPoolRead): void {
    const mine = this.#mine.get(session.pool)
    if (!mine || !this.#pubkey) return
    const own = new Map<string, EntryMember>()
    for (const member of read.members ?? []) if (member.signer === this.#pubkey) own.set(member.name, member)
    if (!own.size) return
    mine.used = Math.max(mine.used, own.size)
    const onPage = [...own.values()]
      .filter(member => member.page === mine.page)
      .sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const newest = onPage[0]
    if (newest && newest.at >= mine.at) {
      mine.standing = newest.gone ? 'gone' : 'posted'
      if (!newest.gone) { mine.name = newest.label; mine.title = newest.title }
      else if (!mine.name) { mine.name = newest.label; mine.title = newest.title }
    }
    mine.at = Math.max(mine.at, ...[...own.values()].map(member => member.at))
  }

  /** A post whose answer never came: the pool is read again only to learn what the host kept. Nothing else is redrawn
   *  when the host still does not answer. */
  async #recount(session: Session): Promise<void> {
    const { path } = session
    if (!path) return
    const read = await readEntryPool(path, session.pool, this.#readDeps())
    if (session.gone) return
    if (read.reached && (read.state === 'open' || read.state === 'closed')) {
      session.read = read
      session.offset = read.offset
      this.#derive(session, read)
      await this.#list(session, read)
    }
    this.#measure(session)
  }

  /** The pool's template, read once at this origin and held for the page's life. */
  async #template(session: Session): Promise<RecipeTemplate | null> {
    if (session.template || !session.record) return session.template
    const bytes = await readEntryAtom(session.origin, session.record.template, RECIPE_LIMITS.templateBytes, this.#readDeps())
    const parsed = bytes ? await parseRecipeTemplate(bytes, session.record.template) : null
    if (!bytes || !parsed?.ok) return null
    session.template = parsed.template
    session.templateBytes = bytes
    return parsed.template
  }

  /** Step 10: what has been posted, as the catalogue's cards, under the person who signed each. */
  async #list(session: Session, read: EntryPoolRead): Promise<void> {
    const record = session.record
    if (!record) return
    const offers = await postedRecipeOffers(read.rows, { pool: session.pool, host: session.origin, template: record.template, own: this.#pubkey })
    if (session.gone) return
    session.offers = new Map(offers.map(offer => [offer.sig, offer]))
    const note = read.why === 'hidden-unread'
      ? t('recipe.post.posted.hidden-unread', 'The leader\'s list of hidden entries did not arrive, so nothing posted here is shown.')
      : read.over
        ? t('recipe.post.posted.over', 'This host listed more entries than a pool holds. The first {max} are shown.', { max: ENTRY_LIMITS.listed })
        : offers.length ? '' : t('recipe.post.posted.none', 'Nothing has been posted here yet.')
    session.page.setPosted(offers.map(offer => ({ sig: offer.sig, name: offer.entry.name, nodes: offer.nodes, ...(offer.at !== undefined ? { at: offer.at } : {}) })), note)
  }

  // ── the form ─────────────────────────────────────────────────────────────

  /** Step 7: the room left in bytes and the changes left, and which presses are open. */
  #measure(session: Session): void {
    const mine = this.#mine.get(session.pool)
    const template = session.template
    if (!mine || !template || session.read?.state !== 'open') return
    const fields = session.page.fields()
    const { recipe } = recipePostDocument(template, fields, t)
    const content = Object.keys(recipe.values).length ? new TextDecoder().decode(recipeBytes(recipe)) : ''
    const room = entryRoomLeft({ pool: session.pool, page: mine.page, name: fields.name.trim(), title: fields.title.trim(), content })
    const changes = recipePostChanges(mine.used, mine.standing)
    const space = room >= 0
      ? t('recipe.post.measure.room', '{bytes} bytes of room left', { bytes: room })
      : t('recipe.post.measure.over', '{bytes} bytes too many for one entry', { bytes: -room })
    const left = t('recipe.post.measure.changes', '{left} of {max} changes left', { left: changes.left, max: RECIPE_POST_CHANGES })
    const measured = t('recipe.post.measure', '{room}, and {changes}.', { room: space, changes: left })
    const kept = !changes.post && changes.takeBack ? ` ${t('recipe.post.measure.kept', 'The last one is kept for taking your entry back.')}` : ''
    session.page.setMeasure(`${measured}${kept}`, room < 0)
    session.page.setActions({
      post: changes.post && room >= 0 && !session.busy,
      takeBack: changes.takeBack && !session.busy,
      posted: mine.standing === 'posted',
    })
  }

  /** Steps 8 and 9: one press posts the entry, or takes it back, and says where it went. */
  async #post(session: Session, back: boolean): Promise<void> {
    const mine = this.#mine.get(session.pool)
    const { path, template, record } = session
    if (session.busy || session.gone || !mine || !path || !template || !record || session.read?.state !== 'open') return
    const changes = recipePostChanges(mine.used, mine.standing)
    if (back ? !changes.takeBack : !changes.post) return
    let entry: { page: string; name: string; title: string; content: string; gone?: boolean }
    if (back) entry = { page: mine.page, name: mine.name, title: mine.title, content: '', gone: true }
    else {
      const built = await recipePostRecipe(template, session.page.fields(), t)
      if (!built.ok) { session.page.setSaid(built.reason, 'bad'); return }
      entry = { page: mine.page, name: built.name, title: built.title, content: built.content }
    }
    session.busy = true
    this.#measure(session)
    session.page.setSaid(back ? t('recipe.post.taking-back', 'Taking your entry back.') : t('recipe.post.posting', 'Posting your entry.'))
    // A change stands over the last one only when it is newer: two presses in one second would tie, and a tie
    // is decided by the member's name. So each is stamped at least a second after the one before.
    const offset = Math.max(session.offset, mine.at + 1 - Math.floor(this.#now() / 1000))
    const result = await postEntryMember({ path, pool: session.pool, secretKey: this.#key(), offset, entry }, this.#postDeps())
    session.busy = false
    if (session.gone) return
    if (!result.ok) {
      session.page.setSaid(result.reason, 'bad')
      // The host said the pool is no longer open: ask it again, so the page says what it is now.
      if (result.status === 403 || result.status === 404 || result.status === 410) await this.#refresh(session)
      // The answer never came: the host may have kept it. What it holds is read back.
      else if (result.status === undefined) await this.#recount(session)
      else this.#measure(session)
      return
    }
    mine.at = Math.max(mine.at, result.event.created_at)
    const where = { title: record.title, host: new URL(session.origin).host }
    const wasPosted = mine.standing === 'posted'
    // A member the host already held was not written: it spends nothing.
    if (!result.held) mine.used += 1
    if (back) {
      mine.standing = 'gone'
      session.page.setSaid(t('recipe.post.taken-back', 'Your entry is taken back from {title} at {host}.', where), 'good')
    } else {
      mine.standing = 'posted'
      mine.name = entry.name
      mine.title = entry.title
      session.page.setSaid(wasPosted
        ? t('recipe.post.changed', 'Your change is posted to {title} at {host}.', where)
        : t('recipe.post.posted', 'Posted to {title} at {host}.', where), 'good')
    }
    await this.#refresh(session)
  }

  // ── the read-along ───────────────────────────────────────────────────────

  async #open(session: Session, sig: string): Promise<void> {
    const offer = session.offers.get(sig)
    if (!offer || session.gone) return
    const held = session.templateBytes
    const opened = await openRecipeEntry(offer, {
      // Nothing of this page's store is asked: the template is the one already read, or the host's.
      store: {},
      io: { atom: (host, wanted, limit) => wanted === session.record?.template && held ? Promise.resolve(held) : readEntryAtom(host, wanted, limit, this.#readDeps()) },
    })
    if (session.gone) return
    if (!opened.ok) { session.page.setSaid(opened.reason, 'bad'); return }
    const named = opened.recipe.template
    session.page.showRecipe({
      title: offer.entry.name,
      recipe: { ...(named ? { template: named } : {}), values: opened.recipe.values },
      template: opened.template ?? session.template ?? DEFAULT_RECIPE_TEMPLATES[0]!,
    })
  }

  // ── leaving ──────────────────────────────────────────────────────────────

  /** Take the page away. The code stays taken (the same one announced again is nothing new) unless the person closed it. */
  #end(): void {
    const session = this.#session
    if (!session) return
    this.#session = null
    session.gone = true
    session.page.dispose()
    EffectBus.emitTransient('keymap:release', { reason: OWNER })
  }
}

window.ioc.register('@diamondcoreprocessor.com/RecipePostDrone', new RecipePostDrone())
