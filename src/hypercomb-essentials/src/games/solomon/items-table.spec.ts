// @vitest-environment jsdom
//
// `attainments.ts` (a sibling Phase-2 file owned by the 'story' role, per
// the file plan) is mocked here rather than imported for real — the same
// pattern `labyrinth-overlay.spec.ts` already uses for `./tile-surface.js`.
// `ItemsTable` itself still imports and calls the REAL exports at runtime
// (`attainmentById`/`attainmentsOf`/`heldAttainments`/`itemsBoards`/
// `itemsProgress`/`useVerb`) — nothing here reimplements that derivation;
// this file only substitutes a small, controlled registry so the panel's
// OWN rendering/dispatch logic can be exercised in isolation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemsTable, type ItemsTableHooks } from './items-table.js'

// One unified registry array, exactly like the real `ATTAINMENTS` — held
// state is a SEPARATE `held` set, never a field on the def itself, because
// `attainmentsOf`/`heldAttainments` (real behaviour, confirmed against the
// actual `attainments.ts`) filter the one registry by held state; they do
// NOT hold two separate lists. `ATTAINMENTS` itself (unfiltered) is what
// `ItemsTable` reads for the Weapons & Spells group, since that group is the
// one place a NOT-yet-held row still needs to appear (as a silhouette, M4).
const fixtures = vi.hoisted(() => ({
  held: new Set<string>(),
  boards: [] as Array<{ id: string; title: string; kind: string; slots: readonly Record<string, unknown>[] }>,
  attainments: [] as Record<string, unknown>[],
  verbs: new Map<string, string | null>(),
}))

vi.mock('./attainments.js', () => ({
  ATTAINMENTS: fixtures.attainments,
  attainmentById: (id: string) => fixtures.attainments.find(def => def.id === id) ?? null,
  attainmentsOf: (kind: string) => fixtures.attainments.filter(def => def.kind === kind && fixtures.held.has(def.id as string)),
  heldAttainments: () => fixtures.attainments.filter(def => fixtures.held.has(def.id as string)),
  itemsBoards: () => fixtures.boards,
  itemsProgress: (boards: readonly { slots: readonly { shown: boolean; filled: boolean }[] }[]) =>
    boards.reduce((acc, board) => {
      for (const slot of board.slots) { if (slot.shown) acc.shown++; if (slot.filled) acc.filled++ }
      return acc
    }, { filled: 0, shown: 0 }),
  useVerb: (def: Record<string, unknown>) => fixtures.verbs.get(def.id as string) ?? null,
}))

function makeHooks(overrides: Partial<ItemsTableHooks> = {}): ItemsTableHooks & { useCalls: string[] } {
  const useCalls: string[] = []
  return {
    facts: () => ({ has: () => false, knows: () => false, done: () => false }),
    context: () => ({ place: 'labyrinth', group: null, shrine: null, needle: null }),
    use: (id: string) => useCalls.push(id),
    closed: vi.fn(),
    useCalls,
    ...overrides,
  }
}

function addDef(def: Record<string, unknown>, held = false): void {
  fixtures.attainments.push(def)
  if (held) fixtures.held.add(def.id as string)
}

function skillDef(id: string, kind: 'weapon' | 'spell' | 'ability', title: string): Record<string, unknown> {
  return { id, kind, title, words: `${title} words.`, art: { kind: 'skill', skill: id.replace('skill:', '') } }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  fixtures.held.clear()
  fixtures.boards.length = 0
  fixtures.attainments.length = 0
  fixtures.verbs.clear()
})
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

describe('ItemsTable: the one Items panel', () => {
  it('is hidden until shown, and the sole close control (×) closes it', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const hooks = makeHooks()
    const table = new ItemsTable(host, hooks)
    const backdrop = host.querySelector('.sol-items') as HTMLElement
    expect(backdrop.hidden).toBe(true)
    expect(table.isOpen).toBe(false)

    table.show()
    expect(table.isOpen).toBe(true)
    expect(backdrop.hidden).toBe(false)

    const close = host.querySelector('.sol-items-close') as HTMLButtonElement
    expect(close.title).toBe('Close (I)')
    close.click()
    expect(hooks.closed).toHaveBeenCalledTimes(1)
    expect(table.isOpen).toBe(false)
    expect(backdrop.hidden).toBe(true)
  })

  it("the Items tab's first h3 is 'Weapons & Spells', listing weapons then spells, each a li.sol-items-row[data-id]", () => {
    addDef(skillDef('skill:sickle', 'weapon', 'Sickle of the Sun'), true)
    addDef(skillDef('skill:ward', 'spell', 'Ward of Solomon'), true)
    fixtures.verbs.set('skill:sickle', 'Equip')
    fixtures.verbs.set('skill:ward', 'Equip')
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show('items')
    const section = host.querySelector('.sol-items-section[data-tab=items]') as HTMLElement
    expect(section.querySelector('h3')?.textContent).toBe('Weapons & Spells')
    const rows = section.querySelectorAll('.sol-items-group')[0]!.querySelectorAll('li.sol-items-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute('data-id')).toBe('skill:sickle')
    expect(rows[1]!.getAttribute('data-id')).toBe('skill:ward')
  })

  it('a held weapon not currently equipped renders an Equip button that dispatches through hooks.use', () => {
    addDef(skillDef('skill:sickle', 'weapon', 'Sickle of the Sun'), true)
    fixtures.verbs.set('skill:sickle', 'Equip')
    const host = document.createElement('div')
    const hooks = makeHooks()
    const table = new ItemsTable(host, hooks)
    table.show('items')
    const row = host.querySelector('li.sol-items-row[data-id="skill:sickle"]') as HTMLElement
    expect(row.classList.contains('is-silhouette')).toBe(false)
    expect(row.querySelector('strong')?.textContent).toBe('Sickle of the Sun')
    const button = row.querySelector('button.sol-items-use') as HTMLButtonElement
    expect(button.textContent).toBe('Equip')
    button.click()
    expect(hooks.useCalls).toEqual(['skill:sickle'])
  })

  it('the currently equipped weapon renders no button, just "Equipped" (useVerb returns null)', () => {
    addDef(skillDef('skill:sickle', 'weapon', 'Sickle of the Sun'), true)
    fixtures.verbs.set('skill:sickle', null)
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show('items')
    const row = host.querySelector('li.sol-items-row[data-id="skill:sickle"]') as HTMLElement
    expect(row.querySelector('button.sol-items-use')).toBeNull()
    expect(row.querySelector('.sol-items-equipped')?.textContent).toBe('Equipped')
  })

  it('an unheld weapon/spell renders a silhouette row with the fixed per-kind copy, no button', () => {
    addDef(skillDef('skill:sling', 'weapon', 'Tideglass Sling'))
    addDef(skillDef('skill:ember', 'spell', 'Ember Sigil'))
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show('items')
    const weaponRow = host.querySelector('li.sol-items-row[data-id="skill:sling"]') as HTMLElement
    const spellRow = host.querySelector('li.sol-items-row[data-id="skill:ember"]') as HTMLElement
    expect(weaponRow.classList.contains('is-silhouette')).toBe(true)
    expect(weaponRow.textContent).toBe('A weapon — not yet found')
    expect(weaponRow.querySelector('button')).toBeNull()
    expect(spellRow.textContent).toBe('A spell — not yet found')
  })

  it('the Stand (an ability) never appears in the Weapons & Spells group — it surfaces once, among Knowledge/Abilities', () => {
    addDef({ id: 'skill:stand', kind: 'ability', title: 'The Stand', words: 'Meet what is coming.', art: { kind: 'skill', skill: 'stand' } }, true)
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())

    table.show('items')
    expect(host.querySelector('li.sol-items-row[data-id="skill:stand"]')).toBeNull()

    table.show('knowledge')
    const rows = host.querySelectorAll('.sol-items-section[data-tab=knowledge] li.sol-items-row[data-id="skill:stand"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.querySelector('strong')?.textContent).toBe('The Stand')
  })

  it('renders one h3 + row list per board matching the active tab, folding contributions boards into Tasks', () => {
    fixtures.boards.push(
      { id: 'star', title: 'The Star', kind: 'relics', slots: [{ id: 'a', name: 'A point', look: 'triangle', shown: true, filled: true, hint: null, attainment: 'piece:a' }] },
      { id: 'quests', title: 'Open threads', kind: 'tasks', slots: [] },
      { id: 'favours', title: 'Favours done', kind: 'contributions', slots: [] },
    )
    addDef({ id: 'piece:a', kind: 'piece', title: 'A Triangle Point', words: 'One of six.', art: { kind: 'piece', piece: 'triangle', point: 0 } }, true)
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())

    table.show('pieces')
    const piecesSection = host.querySelector('.sol-items-section[data-tab=pieces]') as HTMLElement
    expect(piecesSection.querySelector('h3')?.textContent).toBe('The Star')
    const row = piecesSection.querySelector('li.sol-items-row[data-id="piece:a"]') as HTMLElement
    expect(row.querySelector('strong')?.textContent).toBe('A Triangle Point')

    table.show('tasks')
    const tasksSection = host.querySelector('.sol-items-section[data-tab=tasks]') as HTMLElement
    const headings = [...tasksSection.querySelectorAll('h3')].map(h => h.textContent)
    expect(headings).toEqual(['Open threads', 'Favours done'])
  })

  it('a board slot renders filled (real art), shown-but-unfilled as a hinted silhouette, and fully hidden as a bare "?"', () => {
    fixtures.boards.push({
      id: 'wayfarer', title: 'The Wayfarer', kind: 'places', slots: [
        { id: 'found', name: 'A found place', look: 'place', shown: true, filled: true, hint: null, attainment: 'place:found' },
        { id: 'known', name: 'A known place', look: 'place', shown: true, filled: false, hint: 'Somewhere south.', attainment: null },
        { id: 'unknown', name: 'An unknown place', look: 'place', shown: false, filled: false, hint: null, attainment: null },
      ],
    })
    addDef({ id: 'place:found', kind: 'place', title: 'The Cistern', words: 'Cold and still.', art: { kind: 'place', sprite: 'cavern' } }, true)
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show('places')
    const rows = host.querySelectorAll('.sol-items-section[data-tab=places] li.sol-items-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.classList.contains('is-silhouette')).toBe(false)
    expect(rows[0]!.querySelector('strong')?.textContent).toBe('The Cistern')
    expect(rows[1]!.classList.contains('is-silhouette')).toBe(true)
    expect(rows[1]!.querySelector('strong')?.textContent).toBe('A known place')
    expect(rows[1]!.querySelector('span')?.textContent).toBe('Somewhere south.')
    expect(rows[2]!.classList.contains('is-silhouette')).toBe(true)
    expect(rows[2]!.querySelector('strong')?.textContent).toBe('?')
    expect(rows[2]!.querySelector('span')).toBeNull()
  })

  it('switching tabs shows only the active section and marks its tab button is-active', () => {
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show('pieces')
    expect(table.tab).toBe('pieces')
    expect((host.querySelector('.sol-items-tab[data-tab=pieces]') as HTMLElement).classList.contains('is-active')).toBe(true)
    for (const tab of ['items', 'knowledge', 'places', 'tasks']) {
      expect((host.querySelector(`.sol-items-section[data-tab=${tab}]`) as HTMLElement).hidden).toBe(true)
    }
    table.show('places')
    expect((host.querySelector('.sol-items-section[data-tab=places]') as HTMLElement).hidden).toBe(false)
    expect((host.querySelector('.sol-items-section[data-tab=pieces]') as HTMLElement).hidden).toBe(true)
    expect((host.querySelector('.sol-items-tab[data-tab=places]') as HTMLElement).classList.contains('is-active')).toBe(true)
    expect((host.querySelector('.sol-items-tab[data-tab=pieces]') as HTMLElement).classList.contains('is-active')).toBe(false)
  })

  it('the progress line reads filled/shown across every board', () => {
    fixtures.boards.push({
      id: 'star', title: 'The Star', kind: 'relics', slots: [
        { id: 'a', name: 'A', look: 'triangle', shown: true, filled: true, hint: null, attainment: 'piece:a' },
        { id: 'b', name: 'B', look: 'triangle', shown: true, filled: false, hint: null, attainment: null },
        { id: 'c', name: 'C', look: 'triangle', shown: false, filled: false, hint: null, attainment: null },
      ],
    })
    addDef({ id: 'piece:a', kind: 'piece', title: 'A', words: 'w', art: { kind: 'piece', piece: 'triangle', point: 0 } }, true)
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show()
    expect((host.querySelector('.sol-items-progress') as HTMLElement).textContent).toBe('1/2 found')
  })

  it('Tab cycles focus through the tab buttons and the close button only', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const table = new ItemsTable(host, makeHooks())
    table.show()
    const panel = host.querySelector('.sol-items-panel') as HTMLElement
    const focusable = [...host.querySelectorAll('.sol-items-tab'), host.querySelector('.sol-items-close')] as HTMLElement[]
    focusable[0]!.focus()
    for (let i = 0; i < focusable.length; i++) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      panel.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(document.activeElement).toBe(focusable[0])
  })

  it('dispose() removes the panel from the host', () => {
    const host = document.createElement('div')
    const table = new ItemsTable(host, makeHooks())
    table.show()
    table.dispose()
    expect(host.querySelector('.sol-items')).toBeNull()
  })
})
