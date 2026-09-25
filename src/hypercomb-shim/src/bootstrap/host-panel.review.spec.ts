import { afterEach, expect, it, vi } from 'vitest'

const effects = vi.hoisted(() => {
  type Choice = { source: string; pubkey: string; head: string; route?: string; lineage?: string;
    kind?: 'creation'; meaning?: string; key?: string; location?: string }
  const pending: Choice[] = []
  const zones: string[] = []
  return {
    add: vi.fn(async () => true),
    offers: vi.fn(async (_host: string) => [] as unknown[]),
    creations: vi.fn(async (_host: string) => [] as unknown[]),
    addCreation: vi.fn(async () => true),
    active: vi.fn(async () => [] as unknown[]),
    adoptions: vi.fn(async () => [] as unknown[]),
    revisions: vi.fn(async () => [] as unknown[]),
    pending,
    zones,
    stage: vi.fn(async (offer: Choice, source: string) => {
      pending.push({ source, route: offer.route, pubkey: offer.pubkey,
        lineage: offer.lineage, head: offer.head })
      return true
    }),
    stageCreation: vi.fn(async (creation: Choice, source: string) => {
      pending.push({ kind: 'creation', source, pubkey: creation.pubkey, head: creation.head,
        meaning: creation.meaning, key: creation.key, location: creation.location })
      return true
    }),
    listPending: vi.fn(async () => [...pending]),
    clearPending: vi.fn(async (selection: Choice) => {
      const at = pending.findIndex(row => row.source === selection.source
        && row.pubkey === selection.pubkey && row.lineage === selection.lineage
        && row.key === selection.key)
      if (at < 0) return false
      pending.splice(at, 1)
      return true
    }),
  }
})

vi.mock('./hosts', () => ({
  hostZone: (raw: unknown) => String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '',
  listHostZones: vi.fn(async () => [...effects.zones]),
  addHostZone: vi.fn(async (zone: string) => {
    if (!effects.zones.includes(zone)) effects.zones.push(zone)
    return zone
  }),
  removeHostZone: vi.fn(async (zone: string) => {
    const at = effects.zones.indexOf(zone)
    if (at < 0) return false
    effects.zones.splice(at, 1)
    return true
  }),
}))

vi.mock('./offerings', () => ({
  addOffering: effects.add,
  addPublicCreation: effects.addCreation,
  listActiveOfferings: effects.active,
  listActivePublicCreations: vi.fn(async () => []),
  listAdoptions: effects.adoptions,
  listRevisionCandidates: effects.revisions,
  stagePendingSelection: effects.stage,
  stagePendingCreation: effects.stageCreation,
  listPendingSelections: effects.listPending,
  clearPendingSelection: effects.clearPending,
  publicCreationOrigin: (host: string) => `https://${host}`,
  readOfferings: effects.offers,
  readPublicCreations: effects.creations,
  rememberRevisionCandidate: vi.fn(async () => null),
  rememberPublicCreationCandidate: vi.fn(async () => null),
  turnOffOffering: vi.fn(async () => false),
  turnOffPublicCreation: vi.fn(async () => false),
}))

afterEach(() => {
  document.querySelector('hc-shim-hosts')?.remove()
  history.replaceState(null, '', '/')
  effects.add.mockClear()
  effects.offers.mockReset()
  effects.offers.mockResolvedValue([])
  effects.creations.mockReset()
  effects.creations.mockResolvedValue([])
  effects.addCreation.mockClear()
  effects.active.mockReset()
  effects.active.mockResolvedValue([])
  effects.adoptions.mockReset()
  effects.adoptions.mockResolvedValue([])
  effects.revisions.mockReset()
  effects.revisions.mockResolvedValue([])
  effects.stage.mockClear()
  effects.stageCreation.mockClear()
  effects.listPending.mockClear()
  effects.clearPending.mockClear()
  effects.pending.splice(0)
  effects.zones.splice(0)
  localStorage.removeItem('hypercomb:gallery:pins')
})

it('shows a returned tile in local revision review and activates only after a click', async () => {
  const publisher = 'a'.repeat(64)
  const offer = {
    kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
    lineage: 'garden', pubkey: publisher, head: 'b'.repeat(64),
    location: 'c'.repeat(64), doors: ['example.com'], index: { created_at: 1 },
  }
  effects.offers.mockResolvedValue([offer])
  const query = new URLSearchParams({ add: offer.route, publisher, lineage: offer.lineage, source: 'example.com' })
  history.replaceState(null, '', `/hosts?${query}`)

  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(effects.stage).toHaveBeenCalledOnce())
  expect(effects.add).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(root.querySelector('.review button')?.textContent).toBe('Turn on here'))
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(
    '.offer-update')?.getAttribute('aria-label')).toBe('Review selected revision of Garden'))
  const sourceLink = [...root.querySelectorAll<HTMLAnchorElement>('.domain-link')]
    .find(link => link.textContent === 'example.com')!
  expect(new URL(sourceLink.href).searchParams.get('home')).toBe(`${location.origin}/`)
  expect(root.querySelector('.review')?.textContent).toContain('Garden')
  expect(effects.add).not.toHaveBeenCalled()
  ;(root.querySelector('.review button') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(effects.add).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(effects.clearPending).toHaveBeenCalledOnce())
  expect(effects.pending).toHaveLength(0)
})

it('verifies and turns on each selected revision from one review list', async () => {
  const offer = (title: string, letter: string) => ({
    kind: 'host:offering', title, route: `https://${title.toLowerCase()}.example.com/`,
    lineage: title.toLowerCase(), pubkey: letter.repeat(64), head: 'c'.repeat(64),
    location: 'd'.repeat(64), doors: ['example.com'], index: { created_at: 1 },
  })
  const garden = offer('Garden', 'a')
  const studio = offer('Studio', 'b')
  effects.offers.mockResolvedValue([garden, studio])
  const select = [garden, studio].map(row => ({ add: row.route, publisher: row.pubkey,
    lineage: row.lineage, head: row.head }))
  history.replaceState(null, '', `/hosts?${new URLSearchParams({
    source: 'example.com', select: JSON.stringify(select),
  })}`)

  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.review-actions button')?.textContent)
    .toBe('Turn on all 2'))
  expect(effects.add).not.toHaveBeenCalled()
  root.querySelector<HTMLButtonElement>('.review-actions button')!.click()
  await vi.waitFor(() => expect(effects.add).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(effects.pending).toHaveLength(0))
  expect(root.querySelector('.review')).toBeNull()
})

it('marks a newer signed head on its tile and sends the visitor to that source', async () => {
  effects.zones.push('example.com')
  localStorage.setItem('hypercomb:gallery:pins', JSON.stringify(['example.com']))
  const offer = {
    kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
    lineage: 'garden', pubkey: 'a'.repeat(64), head: 'c'.repeat(64),
    location: 'd'.repeat(64), doors: ['example.com'], index: { created_at: 2 },
  }
  effects.offers.mockImplementation(async (host: string) => host === 'example.com' ? [offer] : [])
  effects.adoptions.mockResolvedValue([{
    kind: 'host:adoption', route: offer.route, localRoute: 'garden.localhost',
    lineage: offer.lineage, pubkey: offer.pubkey, head: 'b'.repeat(64),
    source: 'example.com', at: 1,
  }])
  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelector<HTMLAnchorElement>('.offer-update')?.textContent)
    .toContain('New revision'))
  const badge = root.querySelector<HTMLAnchorElement>('.offer-update')!
  expect(new URL(badge.href).hostname).toBe('example.com')
  expect(new URL(badge.href).searchParams.get('home')).toBe(`${location.origin}/`)
  expect(root.textContent).not.toContain('Check updates')
  const reads = effects.offers.mock.calls.filter(([host]) => host === 'example.com').length
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(effects.offers.mock.calls.filter(([host]) => host === 'example.com').length)
    .toBeGreaterThan(reads))
})

it('selects multiple visited-domain tiles and returns only the enabled choices', async () => {
  const offer = (title: string, letter: string) => ({
    kind: 'host:offering', title, route: `https://${title.toLowerCase()}.example.com/`,
    lineage: title.toLowerCase(), pubkey: letter.repeat(64), head: 'c'.repeat(64),
    location: 'd'.repeat(64), doors: ['example.com'], index: { created_at: 1 },
  })
  effects.offers.mockResolvedValue([offer('Garden', 'a'), offer('Studio', 'b')])
  history.replaceState(null, '', '/hosts?home=https%3A%2F%2Fmy.example.com%2F')

  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelectorAll('.offer-select')).toHaveLength(2))
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.offer-select')]
  buttons[0]!.click()
  buttons[1]!.click()
  expect(effects.stage).not.toHaveBeenCalled()
  let returnLink = root.querySelector<HTMLAnchorElement>('.selection-return a')!
  let handoff = new URL(returnLink.href)
  expect(handoff.origin).toBe('https://my.example.com')
  expect(handoff.searchParams.get('source')).toBe(location.host)
  expect(JSON.parse(handoff.searchParams.get('select') ?? '[]')).toHaveLength(2)

  root.querySelectorAll<HTMLButtonElement>('.offer-select')[0]!.click()
  returnLink = root.querySelector<HTMLAnchorElement>('.selection-return a')!
  handoff = new URL(returnLink.href)
  const selected = JSON.parse(handoff.searchParams.get('select') ?? '[]') as Array<{ lineage: string }>
  expect(selected.map(row => row.lineage)).toEqual(['studio'])
})

it('selects a text theme on the visited host and activates it only after local review', async () => {
  const creation = {
    kind: 'host:creation', title: 'Editorial', meaning: 'themes:text', key: 'editorial',
    host: location.host, pubkey: 'a'.repeat(64), location: 'b'.repeat(64),
    head: 'c'.repeat(64), payload: 'd'.repeat(64), index: { created_at: 1 },
  }
  effects.creations.mockResolvedValue([creation])
  history.replaceState(null, '', '/hosts?home=https%3A%2F%2Fmy.example.com%2F')
  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  let root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelectorAll('.offer-select')).toHaveLength(1))
  root.querySelector<HTMLButtonElement>('.offer-select')!.click()
  const handoff = new URL(root.querySelector<HTMLAnchorElement>('.selection-return a')!.href)
  const chosen = JSON.parse(handoff.searchParams.get('select') ?? '[]') as Array<Record<string, string>>
  expect(chosen).toEqual([{ kind: 'creation', publisher: creation.pubkey,
    meaning: creation.meaning, key: creation.key, location: creation.location, head: creation.head }])
  expect(effects.addCreation).not.toHaveBeenCalled()

  document.querySelector('hc-shim-hosts')!.remove()
  history.replaceState(null, '', `/hosts?${handoff.searchParams}`)
  showHostPanel()
  root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(effects.stageCreation).toHaveBeenCalledOnce())
  expect(effects.addCreation).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('.offer-update')).not.toBeNull())
  await vi.waitFor(() => expect(root.querySelector('.review button')?.textContent).toBe('Turn on here'))
  root.querySelector<HTMLButtonElement>('.review button')!.click()
  await vi.waitFor(() => expect(effects.addCreation).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(effects.clearPending).toHaveBeenCalledOnce())
  expect(effects.pending).toHaveLength(0)
})

it('sends a remote text-theme card to its host before local activation', async () => {
  effects.zones.push('example.com')
  localStorage.setItem('hypercomb:gallery:pins', JSON.stringify(['example.com']))
  const creation = {
    kind: 'host:creation', title: 'Editorial', meaning: 'themes:text', key: 'editorial',
    host: 'example.com', pubkey: 'a'.repeat(64), location: 'b'.repeat(64),
    head: 'c'.repeat(64), payload: 'd'.repeat(64), index: { created_at: 1 },
  }
  effects.creations.mockImplementation(async (host: string) => host === 'example.com' ? [creation] : [])
  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelector('.offer-main')?.textContent).toContain('Editorial'))
  const details = root.querySelector<HTMLDetailsElement>('.offer-details')!
  const visit = [...details.querySelectorAll<HTMLAnchorElement>('a')]
    .find(link => link.textContent === 'Visit host to turn on')!
  expect(visit.href).toContain('https://example.com/')
  expect(new URL(visit.href).searchParams.get('home')).toBe(`${location.origin}/`)
  expect(effects.addCreation).not.toHaveBeenCalled()
})

it('shows local deployment tiles and known revisions in host details without package listings', async () => {
  const publisher = 'a'.repeat(64)
  const previous = 'b'.repeat(64)
  const current = 'c'.repeat(64)
  const localRoute = 'garden.localhost'
  const offer = {
    kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
    lineage: 'garden', pubkey: publisher, head: current,
    location: 'd'.repeat(64), doors: ['example.com'], index: { created_at: 2 },
  }
  effects.offers.mockResolvedValue([offer])
  effects.active.mockResolvedValue([{
    name: 'host:activation', enabled: true, pubkey: publisher, lineage: 'garden',
    sourceRoute: offer.route, localRoute, head: current, source: 'example.com',
  }])
  effects.adoptions.mockResolvedValue([{
    kind: 'host:adoption', route: offer.route, localRoute, lineage: 'garden',
    pubkey: publisher, head: current, source: 'example.com', at: 2,
  }])
  effects.revisions.mockResolvedValue([{
    kind: 'host:revision-candidate', pubkey: publisher, lineage: 'garden',
    route: offer.route, source: 'example.com', location: offer.location,
    from: previous, to: current, index: 'e'.repeat(64),
  }])

  const { showHostPanel } = await import('./host-panel')
  showHostPanel()
  const root = document.querySelector('hc-shim-hosts')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelector('details.technical')).not.toBeNull())
  const details = root.querySelector('details.technical') as HTMLDetailsElement
  details.open = true
  details.dispatchEvent(new Event('toggle'))
  await vi.waitFor(() => expect(details.textContent).toContain(localRoute))
  expect(details.textContent).toContain(current.slice(0, 12))
  expect(details.textContent).toContain(previous.slice(0, 12))
  expect(details.textContent).not.toMatch(/essentials|Replicate a package by signature|Latest offered revision|Browse publication history/i)
})
