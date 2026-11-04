import { describe, expect, it } from 'vitest'
import { SHELVES_MENU, shelvesMenu } from './quick-menu.shelves.js'
import type { ContextGroup } from '../assistant/context-groups.js'

const group = (id: string, label: string): ContextGroup => ({ kind: 'context-group', id, label, members: [], at: 0 })

describe('the context data ring', () => {
  it('is not any other menu', () => {
    expect(shelvesMenu('root:view', [])).toBeUndefined()
  })

  it('keeps a new shelf at the centre and one kept group in each direction', () => {
    const menu = shelvesMenu(SHELVES_MENU, [group('a', 'one'), group('b', 'two')])!
    expect(menu.slots[0]).toMatchObject({ direction: 'centre', action: { effect: 'shelf:save' } })
    expect(menu.slots[1]).toMatchObject({ direction: 'east', label: 'one', action: { effect: 'shelf:recall', payload: { id: 'a' } } })
    expect(menu.slots[2]).toMatchObject({ direction: 'southeast', label: 'two' })
  })

  it('shows no more groups than the ring has directions', () => {
    const many = Array.from({ length: 9 }, (_, i) => group(String(i), `g${i}`))
    expect(shelvesMenu(SHELVES_MENU, many)!.slots).toHaveLength(7)
  })
})
