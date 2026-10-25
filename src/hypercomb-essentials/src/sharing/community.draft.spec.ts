import { describe, expect, it } from 'vitest'
import { CommunityDraft } from './community.draft.js'
import { addCommunity, renameCommunity, toggleItem, toggleCommunityItem, type Showcase } from './showcase-record.js'

const empty: Showcase = { zone: 'example.com', items: [], domains: [] }
const item = { pubkey: 'a'.repeat(64), lineage: 'dylan' }

describe('CommunityDraft', () => {
  it('undoes and redoes switches, and a new change drops the redo', () => {
    const draft = new CommunityDraft(empty)
    draft.apply(toggleItem(empty, item))
    expect(draft.current.items).toHaveLength(1)
    expect(draft.undo()).toBe(true)
    expect(draft.current).toBe(empty)
    expect(draft.canRedo).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(draft.current.items).toHaveLength(1)
    draft.undo()
    draft.apply(addCommunity(empty, 'Daily').ok ? (addCommunity(empty, 'Daily') as any).showcase : empty)
    expect(draft.canRedo).toBe(false)
  })

  it('has nothing to undo at the start, and ignores a change that is the same record', () => {
    const draft = new CommunityDraft(empty)
    expect(draft.undo()).toBe(false)
    draft.apply(empty)
    expect(draft.canUndo).toBe(false)
  })
})

describe('renameCommunity', () => {
  const made = addCommunity(empty, 'Daily') as Extract<ReturnType<typeof addCommunity>, { ok: true }>
  const withMember = toggleCommunityItem(toggleItem(made.showcase, item), made.key, item)

  it('keeps the members under the new name, in the same place', () => {
    const twice = addCommunity(withMember, 'Other') as Extract<ReturnType<typeof addCommunity>, { ok: true }>
    const renamed = renameCommunity(twice.showcase, made.key, 'Morning')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.showcase.communities!.map(community => community.name)).toEqual(['Morning', 'Other'])
    expect(renamed.showcase.communities![0]!.items).toHaveLength(1)
  })

  it('refuses a taken, empty, or reserved name', () => {
    const twice = addCommunity(made.showcase, 'Other') as Extract<ReturnType<typeof addCommunity>, { ok: true }>
    expect(renameCommunity(twice.showcase, made.key, 'Other')).toEqual({ ok: false, reason: 'taken' })
    expect(renameCommunity(twice.showcase, made.key, '  ')).toEqual({ ok: false, reason: 'empty' })
    expect(renameCommunity(twice.showcase, made.key, 'All')).toEqual({ ok: false, reason: 'all' })
  })
})
