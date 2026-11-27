// pools/open-entries-panel.spec.ts : the "Open for posts" row and the control
// that runs it. The leader's side is played by the spec (its flows are
// open-entries-leader.spec.ts's), so what is tested here is what the leader
// sees and in what order things are asked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaderPool, LeaderPostsResult } from './open-entries-leader.js'

const leader = vi.hoisted(() => ({
  read: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  recycle: vi.fn(),
  bring: vi.fn(),
  code: vi.fn(),
}))
vi.mock('./open-entries-leader.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./open-entries-leader.js')>()),
  readLeaderPosts: leader.read,
  openForPosts: leader.open,
  closeForPosts: leader.close,
  recycleForPosts: leader.recycle,
  bringPostsHome: leader.bring,
  showPostsCode: leader.code,
}))

const { EntryPostsControl, entryConfirmWords, entryPoolWords, entryPostsPanel } = await import('./open-entries-panel.js')

const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
const hexOf = (ch: string): string => ch.repeat(64)
const PAGE = 'https://example.com'
const NOW = 1_800_000_000
const TEMPLATE = { sig: hexOf('7'), name: 'Weeknight', bytes: new Uint8Array([1]), meaning: 'recipe:entry' }

const pool = (over: Partial<LeaderPool> = {}): LeaderPool => ({
  pool: hexOf('a'), record: hexOf('b'), state: 'open', page: PAGE, until: NOW + 3_600, title: 'Tuesday class',
  known: { record: hexOf('b'), pool: hexOf('a'), host: 'example.com', page: PAGE, title: 'Tuesday class', until: NOW + 3_600 },
  code: `${PAGE}/#post=${hexOf('b')}~${'9'.repeat(32)}`, entries: 3, notHome: 0, rows: [], ...over,
})
const read = (pools: LeaderPool[] = [], pages = [PAGE]): LeaderPostsResult => ({ ok: true, host: 'example.com', pages, pools, told: [] })

/** A control and its row, mounted, with the templates handed in. */
const mounted = () => {
  let row: ReturnType<typeof entryPostsPanel> | null = null
  const control = new EntryPostsControl({
    say,
    deps: { forms: () => [{ meaning: 'recipe:entry', templates: async () => [TEMPLATE] }], now: () => NOW * 1000 },
    onChange: state => row?.update(state),
  })
  row = entryPostsPanel(say, control.actions, () => NOW * 1000)
  row.update(control.state)
  document.body.append(row.element)
  const find = <T extends HTMLElement>(name: string): T => row!.element.querySelector<T>(`.${name}`)!
  const press = (name: string): void => find<HTMLButtonElement>(name).click()
  const lead = (): string => find('hc-posts-say').textContent ?? ''
  return { control, row, find, press, lead }
}

const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(() => {
  document.body.replaceChildren()
  for (const fn of Object.values(leader)) fn.mockReset()
  leader.read.mockResolvedValue(read())
})

describe('the row', () => {
  it('says a pool in words: its title, when it ends, how many entries; one of another device as such', () => {
    expect(entryPoolWords(say, pool(), NOW)).toMatch(/^Tuesday class · ends .+ · 3 entries$/)
    expect(entryPoolWords(say, pool({ entries: 1 }), NOW)).toMatch(/1 entry$/)
    expect(entryPoolWords(say, pool({ state: 'closed' }), NOW)).toMatch(/· closed ·/)
    expect(entryPoolWords(say, pool(), NOW + 7_200)).toMatch(/· closed ·/)
    expect(entryPoolWords(say, pool({ known: null, title: '', until: 0 }), NOW)).toBe('A pool opened on another device is open')
    // Placed by its public record: its title, its end, and where it was opened.
    expect(entryPoolWords(say, pool({ known: null }), NOW)).toMatch(/^Tuesday class · ends .+ · opened on another device$/)
  })

  it('says full when the host\'s listing is full, though changes and take-backs leave fewer rows drawn', () => {
    expect(entryPoolWords(say, pool({ entries: 40, full: true }), NOW)).toMatch(/· 40 entries · full$/)
    expect(entryPoolWords(say, pool({ entries: 40 }), NOW)).not.toMatch(/full/)
  })

  it('gives each pool its code, Close while open, and Recycle; a pool of another device Close and Recycle', async () => {
    leader.read.mockResolvedValue(read([pool(), pool({ pool: hexOf('c'), known: null, code: '', entries: null, notHome: null })]))
    const { control, row } = mounted()
    await control.refresh()
    const items = [...row.element.querySelectorAll('.hc-posts-pool')]
    expect(items.map(item => [...item.querySelectorAll('button')].map(button => button.className)))
      .toEqual([['hc-posts-code', 'hc-posts-close', 'hc-posts-recycle'], ['hc-posts-close', 'hc-posts-recycle']])
  })

  it('draws a refusal as one sentence with whose it is to fix beside it', async () => {
    leader.read.mockResolvedValue({ ok: false, why: 'no-host', reason: 'Name the host your index is kept on first.', whose: 'leader' })
    const { control, lead, find } = mounted()
    await control.refresh()
    expect(lead()).toBe('Name the host your index is kept on first.')
    expect(find('hc-posts-say').dataset['tone']).toBe('refused')
    expect(find('hc-posts-whose').hidden).toBe(false)
    expect(find('hc-posts-whose').textContent).toMatch(/yours to fix/)
  })
})

describe('opening for posts', () => {
  it('offers the pages the index gives, a day by default, and opens with what was picked', async () => {
    leader.open.mockResolvedValue({ ok: true, pool: pool().known, link: 'x', said: '"Tuesday class" takes posts.', shown: true })
    const { control, find, press, lead } = mounted()
    press('hc-posts-start')
    await settle()
    expect(find('hc-posts-form').hidden).toBe(false)
    expect([...find<HTMLSelectElement>('hc-posts-page').options].map(one => one.value)).toEqual([PAGE])
    expect(find<HTMLSelectElement>('hc-posts-days').value).toBe('1')
    expect([...find<HTMLSelectElement>('hc-posts-days').options].map(one => one.value).at(-1)).toBe('31')
    expect(find<HTMLButtonElement>('hc-posts-open').disabled).toBe(true)
    control.choose('title', 'Tuesday class')
    control.choose('days', '7')
    press('hc-posts-open')
    await settle()
    expect(leader.open).toHaveBeenCalledWith(
      { host: 'example.com', page: PAGE, title: 'Tuesday class', days: 7, meaning: 'recipe:entry', template: TEMPLATE, replaces: null },
      expect.anything(),
    )
    expect(lead()).toBe('"Tuesday class" takes posts.')
    expect(find('hc-posts-form').hidden).toBe(true)
  })

  it('says so in one sentence and stops when there is no published page', async () => {
    leader.read.mockResolvedValue(read([], []))
    const { control, lead } = mounted()
    await control.start()
    expect(control.state.forming).toBe(false)
    expect(lead()).toMatch(/no published page/)
  })

  it('asks first when the page\'s pool holds entries not brought home, and brings them before it opens', async () => {
    const last = pool({ notHome: 2 })
    leader.read.mockResolvedValue(read([last]))
    leader.bring.mockResolvedValue({ ok: true, said: 'Brought 2 home.' })
    leader.open.mockResolvedValue({ ok: true, pool: pool().known, link: 'x', said: 'Opened.', shown: true })
    const { control, find, press } = mounted()
    await control.start()
    control.choose('title', 'This week')
    press('hc-posts-open')
    await settle()
    expect(leader.open).not.toHaveBeenCalled()
    expect(find('hc-posts-confirm').hidden).toBe(false)
    expect(find('hc-posts-confirm-words').textContent).toBe(entryConfirmWords(say, 'open', last))
    expect(find('hc-posts-confirm-words').textContent).toMatch(/2 of its entries/)
    press('hc-posts-bring')
    await settle()
    expect(leader.bring).toHaveBeenCalledWith(last, expect.anything())
    expect(leader.open.mock.calls[0]?.[0]).toMatchObject({ replaces: last })
    expect(leader.bring.mock.invocationCallOrder[0]).toBeLessThan(leader.open.mock.invocationCallOrder[0] as number)
  })

  it('opens without bringing when asked, and recycles nothing when bringing failed', async () => {
    const last = pool({ notHome: 1 })
    leader.read.mockResolvedValue(read([last]))
    leader.bring.mockResolvedValue({ ok: false, said: 'The entries could not be brought home.' })
    leader.open.mockResolvedValue({ ok: true, pool: pool().known, link: 'x', said: 'Opened.', shown: true })
    const { control, lead } = mounted()
    await control.start()
    control.choose('title', 'This week')
    await control.open()
    await control.confirm(true)
    expect(leader.open).not.toHaveBeenCalled()
    expect(lead()).toBe('The entries could not be brought home.')
    await control.open()
    await control.confirm(false)
    expect(leader.bring).toHaveBeenCalledTimes(1)
    expect(leader.open).toHaveBeenCalledTimes(1)
  })

  it('shows the flow\'s refusal with whose it is, and keeps the form', async () => {
    leader.open.mockResolvedValue({ ok: false, why: 'page-old-shell', reason: 'The site shell on this host does not take posts yet.', whose: 'operator' })
    const { control, lead, find } = mounted()
    await control.start()
    control.choose('title', 'Tuesday class')
    await control.open()
    expect(lead()).toBe('The site shell on this host does not take posts yet.')
    expect(find('hc-posts-whose').textContent).toMatch(/operator/)
    expect(control.state.forming).toBe(true)
  })
})

describe('closing, recycling and the code', () => {
  it('closes with one press and says what the host said', async () => {
    leader.read.mockResolvedValue(read([pool()]))
    leader.close.mockResolvedValue({ ok: true, said: '"Tuesday class" is closed. The host says so.' })
    const { control, press, lead } = mounted()
    await control.refresh()
    press('hc-posts-close')
    await settle()
    expect(leader.close).toHaveBeenCalledTimes(1)
    expect(lead()).toMatch(/host says so/)
  })

  it('asks first before every recycle, saying the count, and recycles only on the yes', async () => {
    leader.recycle.mockResolvedValue({ ok: true, said: 'Recycled.' })
    const { control, find } = mounted()
    await control.recycle(pool())
    expect(leader.recycle).not.toHaveBeenCalled()
    expect(find('hc-posts-confirm-words').textContent).toBe('Recycling "Tuesday class" lets its entries go; every one of them is in your hive.')
    expect(find('hc-posts-bring').hidden).toBe(true)
    await control.confirm(false)
    expect(leader.recycle).toHaveBeenCalledTimes(1)
    await control.recycle(pool({ notHome: 4 }))
    expect(control.state.confirm).toMatchObject({ kind: 'recycle' })
    expect(find('hc-posts-bring').hidden).toBe(false)
    await control.confirm(false)
    expect(leader.recycle).toHaveBeenCalledTimes(2)
  })

  it('shows the code again, and says so when this device does not hold it', async () => {
    leader.code.mockReturnValueOnce(true).mockReturnValueOnce(false)
    const { control, lead } = mounted()
    control.code(pool())
    expect(lead()).not.toMatch(/does not hold/)
    control.code(pool())
    expect(lead()).toMatch(/does not hold this pool/)
  })
})

describe('a page\'s old pool is never let go unsaid', () => {
  it('asks before opening over a pool whose entries are all home, and says so', async () => {
    const last = pool({ notHome: 0 })
    leader.read.mockResolvedValue(read([last]))
    leader.open.mockResolvedValue({ ok: true, pool: pool().known, link: 'x', said: 'Opened.', shown: true })
    const { control, find } = mounted()
    await control.start()
    control.choose('title', 'This week')
    await control.open()
    expect(leader.open).not.toHaveBeenCalled()
    expect(find('hc-posts-confirm-words').textContent).toBe('This page already has "Tuesday class". Opening a new pool recycles it; every one of its entries is in your hive.')
    expect(find('hc-posts-without').textContent).toBe('Open the new pool')
    await control.confirm(false)
    expect(leader.open.mock.calls[0]?.[0]).toMatchObject({ replaces: last })
  })

  it('says when the entries could not be counted, offers nothing to bring, and opens only on an explicit yes', async () => {
    // The host was down, the hidden list did not read, or this device holds no code: the count is unknown.
    const last = pool({ notHome: null, entries: null })
    leader.read.mockResolvedValue(read([last]))
    leader.open.mockResolvedValue({ ok: true, pool: pool().known, link: 'x', said: 'Opened.', shown: true })
    const { control, find } = mounted()
    await control.start()
    control.choose('title', 'This week')
    await control.open()
    expect(leader.open).not.toHaveBeenCalled()
    expect(find('hc-posts-confirm-words').textContent).toMatch(/could not be counted\. Open only if you are sure\.$/)
    expect(find('hc-posts-bring').hidden).toBe(true)
    // Cancel leaves the old pool where it is.
    find<HTMLButtonElement>('hc-posts-keep').click()
    expect(control.state.confirm).toBeNull()
    expect(leader.open).not.toHaveBeenCalled()
    await control.start()
    await control.open()
    find<HTMLButtonElement>('hc-posts-without').click()
    await settle()
    expect(leader.bring).not.toHaveBeenCalled()
    expect(leader.open).toHaveBeenCalledTimes(1)
  })

  it('asks the same of a pool opened on another device, placed on the page by its public record', async () => {
    const other = pool({ known: null, code: '', entries: null, notHome: null, title: 'Phone class' })
    leader.read.mockResolvedValue(read([other]))
    const { control, find } = mounted()
    await control.start()
    control.choose('title', 'This week')
    await control.open()
    expect(control.state.confirm).toMatchObject({ kind: 'open', pool: other })
    expect(find('hc-posts-confirm-words').textContent).toMatch(/^This page already has "Phone class"/)
  })
})

describe('the row keeps time', () => {
  afterEach(() => { vi.useRealTimers() })

  it('turns "ends ..." to "closed" when the end passes, with the bar up and nothing pressed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW * 1000)
    const ending = pool({ until: NOW + 60, known: { ...(pool().known as NonNullable<LeaderPool['known']>), until: NOW + 60 } })
    const control = new EntryPostsControl({ say, onChange: () => undefined })
    const row = entryPostsPanel(say, control.actions, () => Date.now())
    document.body.append(row.element)
    row.update({ ...control.state, pools: [ending] })
    const words = (): string => row.element.querySelector('.hc-posts-pool-words')?.textContent ?? ''
    expect(words()).toMatch(/· ends /)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(words()).toMatch(/· ends /)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(words()).toMatch(/· closed ·/)
    row.dispose()
  })
})

describe('a full pool', () => {
  it('says "full" once the pool holds as many entries as a listing gives, and not one before', async () => {
    const { ENTRY_LIMITS } = await import('./open-entries.js')
    expect(entryPoolWords(say, pool({ entries: ENTRY_LIMITS.listed }), NOW)).toMatch(new RegExp(`· ${ENTRY_LIMITS.listed} entries · full$`))
    expect(entryPoolWords(say, pool({ entries: ENTRY_LIMITS.listed - 1 }), NOW)).not.toMatch(/full/)
    expect(entryPoolWords(say, pool({ entries: null }), NOW)).not.toMatch(/full/)
  })
})

describe('the confirm, to a keyboard and a screen reader', () => {
  it('is named and described, takes the focus on Cancel, cancels on Escape, and gives the focus back to Recycle', async () => {
    const one = pool()
    leader.read.mockResolvedValue(read([one]))
    const { control, find, row } = mounted()
    await control.refresh()
    const recycle = (): HTMLButtonElement => row.element.querySelector<HTMLButtonElement>('.hc-posts-recycle')!
    recycle().focus()
    recycle().click()
    await settle()
    const confirm = find('hc-posts-confirm')
    expect(confirm.getAttribute('role')).toBe('alertdialog')
    expect(confirm.getAttribute('aria-label')).toBe('Recycle this pool?')
    expect(document.getElementById(confirm.getAttribute('aria-describedby') ?? '')).toBe(find('hc-posts-confirm-words'))
    expect(document.activeElement).toBe(find('hc-posts-keep'))
    confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(control.state.confirm).toBeNull()
    expect(leader.recycle).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(recycle())
  })
})
