// recipe/recipe-post.drone.spec.ts : the post bee against a fake host that
// keeps the rule the way the Cloudflare host does (a listing with its three
// headers, members by name, a PUT checked as a member of this pool and
// stamped against the host's clock). Real: the pool client, the reader, the
// form and the catalogue's cards. Stood in for: the recipe page's read-along,
// by a recorder, so this file pins what the bee asks of it.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ENTRY_LISTING_HEADERS, entryPoolAddress, entryPoolName, entryRecordBytes, forgetEntryMembers, readEntryMember } from '../pools/open-entries.js'
import { recipeBytes, recipeTemplateBytes, type RecipeTemplateDocument } from './recipe-template.js'

const pages = vi.hoisted(() => [] as { title: string; recipe: unknown; template: { name: string }; element: HTMLElement }[])
vi.mock('./recipe-page.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recipePage: (options: { title: string; recipe: unknown; template: { name: string } }) => {
    const element = document.createElement('section')
    element.className = 'hc-recipe fake-read-along'
    pages.push({ ...options, element })
    return { element, dispose: () => undefined }
  },
}))

const asked: string[] = []
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => undefined,
  get: (key: string) => { asked.push(key); return undefined },
}

const here = dirname(fileURLToPath(import.meta.url))
const { RecipePostDrone } = await import('./recipe-post.drone.js')

const enc = new TextEncoder()
const sha = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)), b => b.toString(16).padStart(2, '0')).join('')

const ORIGIN = 'https://class.example.com'
const LEADER = 'b'.repeat(64)
const NONCE = '0123456789abcdef0123456789abcdef'
const HOST_NOW = 1_800_000_000
/** This phone's clock is an hour slow: the host's time is what it stamps with. */
const LOCAL_MS = (HOST_NOW - 3_600) * 1000
const LAYOUT: RecipeTemplateDocument = {
  name: 'Class',
  sections: [
    { key: 'story', kind: 'text', label: 'The story' },
    { key: 'look', kind: 'pictures', label: 'How it looks' },
    { key: 'ingredients', kind: 'ingredients', label: 'What you need' },
  ],
}

type Pool = Awaited<ReturnType<typeof world>>

/** One leader's page: its record, its template, and its pool as the host keeps it. */
const world = async (state: 'open' | 'closed' | 'expired' | null = 'open', meaning = 'recipe:entry') => {
  const layout = recipeTemplateBytes(LAYOUT)
  const template = await sha(layout)
  const until = HOST_NOW + 86_400
  const record = entryRecordBytes({ meaning, title: 'Tuesday class', template, by: LEADER, until })
  const O = await sha(record)
  const A = await entryPoolAddress(O, NONCE)
  const H = await entryPoolName(A, LEADER, until)
  const atoms = new Map<string, Uint8Array>([[O, record], [template, layout]])
  const members: string[] = []
  const held = new Map<string, Uint8Array>()
  const puts: { url: URL; body: Uint8Array }[] = []
  const pool = {
    O, A, H, until, template, atoms, members, held, puts,
    state: state as 'open' | 'closed' | 'expired' | null,
    /** Answer a PUT some other way than the rule would. */
    refuse: null as null | { status: number; reason: string },
    /** Keep a PUT, then lose the answer on its way back. */
    lose: false,
    /** The host does not answer at all. */
    down: false,
    fetch: vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
      const at = new URL(url)
      const words = (status: number, reason: string): Response => new Response(`${reason}\n`, { status, headers: { 'X-Reason': reason } })
      if (pool.down) throw new TypeError('the host did not answer')
      if (at.origin !== ORIGIN) return words(404, 'not this origin')
      if (init.method === 'PUT') {
        const body = new Uint8Array(init.body as ArrayBuffer)
        puts.push({ url: at, body })
        if (pool.refuse) return words(pool.refuse.status, pool.refuse.reason)
        if (pool.state !== 'open') return words(403, 'this one is closed')
        const name = at.pathname.split('/')[2] ?? ''
        const member = await readEntryMember(body, H, name)
        if (!member) return words(400, 'not a member of this pool')
        if (Math.abs(member.at - HOST_NOW) > 600) return words(409, 'entry stamp is more than ten minutes from this host\'s clock')
        if (held.has(name)) return words(200, `member ${name}`)
        held.set(name, body)
        members.push(name)
        if (pool.lose) throw new TypeError('the answer was lost')
        return words(201, `member ${name}`)
      }
      if (at.pathname === `/${A}/` && at.searchParams.get(ENTRY_LISTING_HEADERS.by) === LEADER && at.searchParams.get('until') === String(until)) {
        const headers: Record<string, string> = { [ENTRY_LISTING_HEADERS.hostTime]: String(HOST_NOW) }
        if (pool.state) headers[ENTRY_LISTING_HEADERS.state] = pool.state
        return new Response(members.join('\n'), { status: pool.state ? 200 : 404, headers })
      }
      const member = /^\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(at.pathname)
      if (member?.[1] === A && held.has(member[2] as string)) return new Response(held.get(member[2] as string)!.slice())
      const atom = /^\/([0-9a-f]{64})$/.exec(at.pathname)
      if (atom && atoms.has(atom[1] as string)) return new Response(atoms.get(atom[1] as string)!.slice())
      return words(404, 'not here')
    }),
  }
  return pool
}

const secret = generateSecretKey()
const made: { markDisposed(): void }[] = []

const bee = (pool: Pool, over: Record<string, unknown> = {}) => {
  const drone = new RecipePostDrone({
    origin: () => ORIGIN, visitor: () => true, fetch: pool.fetch, now: () => LOCAL_MS,
    newSecretKey: () => secret, newPage: () => 'c'.repeat(64), ...over,
  })
  made.push(drone)
  return drone
}

const announce = (pool: Pool): void => { EffectBus.emit('entries:code', { record: pool.O, nonce: NONCE }) }
const page = (): HTMLElement | null => document.querySelector('.hc-recipe-post')
const stateText = (): string => page()?.querySelector('.hc-recipe-post-state')?.textContent ?? ''
const said = (): string => page()?.querySelector('.hc-recipe-post-said')?.textContent ?? ''
const formShown = (): boolean => !!page() && !(page()!.querySelector('[role="form"]') as HTMLElement).hidden
const press = (index: number): HTMLButtonElement => page()!.querySelectorAll<HTMLButtonElement>('.hc-recipe-post-actions button')[index]!
const type = (field: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  field.value = value
  field.dispatchEvent(new Event('input'))
}
const fill = (name: string, title: string, story: string): void => {
  const root = page()!
  const [nameField, titleField] = [...root.querySelectorAll<HTMLInputElement>('input.hc-recipe-field')]
  type(nameField!, name)
  type(titleField!, title)
  type(root.querySelector<HTMLTextAreaElement>('textarea[data-kind="text"]')!, story)
}

beforeEach(() => {
  asked.length = 0
  pages.length = 0
  forgetEntryMembers()
})

afterEach(() => {
  for (const drone of made.splice(0)) drone.markDisposed()
  document.body.replaceChildren()
  EffectBus.emit('entries:code', null)
})

describe('the bee sleeps until a code arrives', () => {
  /** Every non-spec source of the package, as the build reads them. */
  const packageSources = (): Map<string, string> => {
    const root = resolve(here, '..')
    const out = new Map<string, string>()
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) && !/^(essentials-keys|side-effects|preload-effects)\.ts$/.test(entry.name)) {
          out.set(relative(root, full).replace(/\\/g, '/'), readFileSync(full, 'utf8'))
        }
      }
    }
    walk(root)
    return out
  }

  it('is filed by the build as a sleeper woken by the code, never as awake', async () => {
    const classifier = pathToFileURL(join(here, '..', '..', 'scripts', 'passive-queen.ts')).href
    type Verdict = { sleeps: boolean; why?: string; wakesOn?: string[] }
    type Judge = (file: string, source: string, others: ReadonlyMap<string, string>) => Verdict
    // Loaded at run time: the build's own classifier lives outside this package's rootDir.
    const { effectSleeper, viewSleeper } = await import(/* @vite-ignore */ classifier) as { effectSleeper: Judge; viewSleeper: Judge }
    const others = packageSources()
    const file = 'recipe/recipe-post.drone.ts'
    const source = others.get(file) as string
    expect(viewSleeper(file, source, others)).toMatchObject({ sleeps: false })
    expect(effectSleeper(file, source, others)).toEqual({ sleeps: true, wakesOn: ['entries:code'] })
    // What would wake it at load instead: a listener in its own file, or another file reaching for it.
    expect(effectSleeper(file, `${source}\nwindow.addEventListener('hashchange', () => undefined)`, others)).toMatchObject({ sleeps: false })
    const reached = new Map(others).set('recipe/elsewhere.ts', `import { RecipePostDrone } from './recipe-post.drone.js'`)
    expect(effectSleeper(file, source, reached)).toMatchObject({ sleeps: false })
  })
})

describe('the page a phone sees', () => {
  it('takes the code from the announcement, never from the address bar, and the same code again is nothing new', async () => {
    const pool = await world()
    location.hash = '#post=' + 'f'.repeat(64) + '~' + 'f'.repeat(32)
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(stateText()).toBe('This one is open. Write your entry below.'))
    expect(pool.fetch.mock.calls.some(([url]) => String(url).includes('f'.repeat(64)))).toBe(false)
    const asksBefore = pool.fetch.mock.calls.length
    announce(pool)
    announce(pool)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(pool.fetch.mock.calls.length).toBe(asksBefore)
    expect(document.querySelectorAll('.hc-recipe-post')).toHaveLength(1)
    location.hash = ''
  })

  it('acts only on a published visitor page', async () => {
    const pool = await world()
    await bee(pool, { visitor: () => false }).pulse('')
    announce(pool)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(page()).toBeNull()
    expect(pool.fetch).not.toHaveBeenCalled()
  })

  it('asks the host first: open draws the form from the template, says when it ends and what posting means', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    const root = page()!
    expect(root.querySelector('h1')?.textContent).toBe('Tuesday class')
    expect(root.textContent).toMatch(/Open until .+\./)
    expect([...root.querySelectorAll('textarea')].map(area => area.dataset['kind'])).toEqual(['text', 'ingredients'])
    expect(root.textContent).toContain('so How it looks is left out')
    expect(root.textContent).toContain('What you post is kept by this host and can be read by anyone with this code.')
    expect(root.querySelector('.hc-recipe-post-measure')?.textContent).toMatch(/^\d+ bytes of room left, and 8 of 8 changes left\.$/)
    // The listing is asked at the page's own origin, with the opener and the end.
    expect(String(pool.fetch.mock.calls.find(([url]) => String(url).includes('?by='))?.[0]))
      .toBe(`${ORIGIN}/${pool.A}/?by=${LEADER}&until=${pool.until}`)
  })

  it('says, in a plain sentence, a code the host does not know, a closed pool and an expired one', async () => {
    const unknown = await world(null)
    await bee(unknown).pulse('')
    announce(unknown)
    await vi.waitFor(() => expect(stateText()).toBe('This host is not taking posts for this code.'))
    expect(formShown()).toBe(false)
    made.splice(0).forEach(drone => drone.markDisposed())

    const expired = await world('expired')
    await bee(expired).pulse('')
    announce(expired)
    await vi.waitFor(() => expect(stateText()).toBe('This one has expired.'))
    expect(formShown()).toBe(false)
    expect((page()!.querySelector('.hc-recipe-post-posted') as HTMLElement).hidden).toBe(true)
  })

  it('says a record that does not arrive, or is for another meaning, is not taken here', async () => {
    const missing = await world()
    missing.atoms.delete(missing.O)
    await bee(missing).pulse('')
    announce(missing)
    await vi.waitFor(() => expect(stateText()).toBe('This host is not taking posts for this code.'))
    made.splice(0).forEach(drone => drone.markDisposed())

    const other = await world('open', 'calendar:entry')
    await bee(other).pulse('')
    announce(other)
    await vi.waitFor(() => expect(stateText()).toBe('This code is for something this page cannot take.'))
  })

  it('posts with a key of its own, stamped with the host\'s time, at the page\'s own origin, and says where it went', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    fill('Ana', 'Sunday soup', 'Slow, and worth it.')
    press(0).click()
    await vi.waitFor(() => expect(said()).toBe('Posted to Tuesday class at class.example.com.'))
    const [put] = pool.puts
    expect(put!.url.origin).toBe(ORIGIN)
    expect(put!.url.search).toBe(`?by=${LEADER}&until=${pool.until}`)
    const member = await readEntryMember(put!.body, pool.H)
    expect(member).toMatchObject({ signer: getPublicKey(secret), at: HOST_NOW, label: 'Ana', title: 'Sunday soup', page: 'c'.repeat(64) })
    expect(member!.content).toBe(new TextDecoder().decode(recipeBytes({ template: pool.template, values: { story: { kind: 'text', text: 'Slow, and worth it.' } } })))
    // Never the shell's signer, and nothing kept.
    expect(asked).not.toContain('@diamondcoreprocessor.com/NostrSigner')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    // Under the form: what has been posted, under the person who signed it.
    await vi.waitFor(() => expect(page()!.querySelector('.hc-recipe-catalogue-card')?.textContent).toContain('Sunday soup'))
    expect(page()!.querySelector('.hc-recipe-catalogue-from')?.textContent).toContain('You')
    expect(page()!.querySelector('.hc-recipe-post-measure')?.textContent).toContain('7 of 8 changes left')
    expect(press(0).textContent).toBe('Post the change')
  })

  it('changes and takes back the person\'s own entry under the same page, one change each', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    fill('Ana', 'Sunday soup', 'First.')
    press(0).click()
    await vi.waitFor(() => expect(pool.members).toHaveLength(1))
    await vi.waitFor(() => expect(press(0).disabled).toBe(false))
    fill('Ana', 'Sunday soup', 'Second.')
    press(0).click()
    await vi.waitFor(() => expect(said()).toBe('Your change is posted to Tuesday class at class.example.com.'))
    await vi.waitFor(() => expect(press(1).disabled).toBe(false))
    press(1).click()
    await vi.waitFor(() => expect(said()).toBe('Your entry is taken back from Tuesday class at class.example.com.'))
    const read = await Promise.all(pool.members.map(name => readEntryMember(pool.held.get(name)!, pool.H, name)))
    expect(read.map(member => member!.page)).toEqual(['c'.repeat(64), 'c'.repeat(64), 'c'.repeat(64)])
    expect(read.map(member => member!.gone)).toEqual([false, false, true])
    // Each later than the one before, so the newest always stands, even within one second.
    expect(read.map(member => member!.at)).toEqual([HOST_NOW, HOST_NOW + 1, HOST_NOW + 2])
    await vi.waitFor(() => expect(page()!.querySelector('.hc-recipe-catalogue-card')).toBeNull())
    expect(page()!.querySelector('.hc-recipe-post-measure')?.textContent).toContain('5 of 8 changes left')
    expect(press(1).hidden).toBe(true)
  })

  it('keeps the last change for a take-back', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    for (let n = 1; n <= 7; n++) {
      fill('Ana', 'Sunday soup', `Version ${n}.`)
      await vi.waitFor(() => expect(press(0).disabled).toBe(false))
      press(0).click()
      await vi.waitFor(() => expect(pool.members).toHaveLength(n))
    }
    await vi.waitFor(() => expect(page()!.querySelector('.hc-recipe-post-measure')?.textContent).toContain('1 of 8 changes left. The last one is kept for taking your entry back.'))
    expect(press(0).disabled).toBe(true)
    expect(press(1).disabled).toBe(false)
  })

  it('says what is wrong with an entry before anything is sent', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    fill('', 'Sunday soup', 'Words.')
    press(0).click()
    await vi.waitFor(() => expect(said()).toContain('Write the name you go by'))
    expect(pool.puts).toHaveLength(0)
    fill('Ana', 'Sunday soup', 'x'.repeat(5_000))
    await vi.waitFor(() => expect(page()!.querySelector('.hc-recipe-post-measure')?.textContent).toMatch(/bytes too many for one entry/))
    expect(press(0).disabled).toBe(true)
  })

  it('shows the host\'s own words when it refuses, and asks again what the pool is now', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    fill('Ana', 'Sunday soup', 'Words.')
    pool.refuse = { status: 403, reason: 'this one is closed' }
    pool.state = 'closed'
    press(0).click()
    await vi.waitFor(() => expect(said()).toBe('this one is closed'))
    await vi.waitFor(() => expect(stateText()).toBe('This one is closed. Here is what was posted.'))
    expect(formShown()).toBe(false)
  })

  it('a closed pool shows what was posted; a posted recipe naming any other signature is not shown', async () => {
    const pool = await world()
    const poster = generateSecretKey()
    const { signEntryMember } = await import('../pools/open-entries.js')
    const post = async (title: string, values: Record<string, unknown>, page: string): Promise<void> => {
      const content = new TextDecoder().decode(recipeBytes({ template: pool.template, values: values as never }))
      const signed = await signEntryMember({ pool: pool.H, page, name: 'Ben', title, content, createdAt: HOST_NOW }, poster)
      if (!signed.ok) throw new Error(signed.reason)
      pool.held.set(signed.name, signed.body)
      pool.members.push(signed.name)
    }
    await post('Bread', { story: { kind: 'text', text: 'Knead.' } }, 'd'.repeat(64))
    await post('Picture', { look: { kind: 'pictures', pictures: ['e'.repeat(64)] } }, 'e'.repeat(64))
    pool.state = 'closed'
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(stateText()).toBe('This one is closed. Here is what was posted.'))
    await vi.waitFor(() => expect(page()!.querySelectorAll('.hc-recipe-catalogue-card')).toHaveLength(1))
    expect(page()!.querySelector('.hc-recipe-catalogue-card')?.textContent).toContain('Bread')
    expect(page()!.querySelector('.hc-recipe-catalogue-from')?.textContent).toContain('Ben')
    expect(formShown()).toBe(false)

    // Opened, it is read along through the pool's template, answered from the member's own bytes.
    const before = pool.fetch.mock.calls.length
    page()!.querySelector<HTMLButtonElement>('.hc-recipe-catalogue-card')!.click()
    await vi.waitFor(() => expect(pages).toHaveLength(1))
    expect(pages[0]).toMatchObject({ title: 'Bread', template: { name: 'Class' }, recipe: { template: pool.template, values: { story: { kind: 'text', text: 'Knead.' } } } })
    // Nothing but the template is asked for: the recipe was in the member.
    expect(pool.fetch.mock.calls.slice(before).map(([url]) => String(url))).toEqual([`${ORIGIN}/${pool.template}`])
  })
})

describe('what the review found', () => {
  it('opens the form again for the same code after the person closed the page', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    page()!.querySelector<HTMLButtonElement>('.hc-recipe-tool')!.click()
    expect(page()).toBeNull()
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    expect(document.querySelectorAll('.hc-recipe-post')).toHaveLength(1)
  })

  it('says a host that did not answer as that, never as an unknown code, and asks again at the next announcement', async () => {
    const pool = await world()
    pool.down = true
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(stateText()).toBe('This host did not answer. Try again in a moment.'))
    expect(formShown()).toBe(false)
    pool.down = false
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
  })

  it('counts a post whose answer was lost from what the host kept, and can still take it back', async () => {
    const pool = await world()
    await bee(pool).pulse('')
    announce(pool)
    await vi.waitFor(() => expect(formShown()).toBe(true))
    fill('Ana', 'Sunday soup', 'Slow, and worth it.')
    pool.lose = true
    press(0).click()
    await vi.waitFor(() => expect(said()).toBe('The host did not answer. Your entry was not posted.'))
    pool.lose = false
    // The host kept it: the page reads that back, and offers the change and the take-back.
    await vi.waitFor(() => expect(page()!.querySelector('.hc-recipe-post-measure')?.textContent).toContain('7 of 8 changes left'))
    await vi.waitFor(() => expect(press(1).disabled).toBe(false))
    expect(press(0).textContent).toBe('Post the change')
    press(1).click()
    await vi.waitFor(() => expect(said()).toBe('Your entry is taken back from Tuesday class at class.example.com.'))
    const read = await Promise.all(pool.members.map(name => readEntryMember(pool.held.get(name)!, pool.H, name)))
    expect(read.map(member => [member!.page, member!.gone, member!.title])).toEqual([['c'.repeat(64), false, 'Sunday soup'], ['c'.repeat(64), true, 'Sunday soup']])
  })
})
