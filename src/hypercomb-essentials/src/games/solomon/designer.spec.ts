// games/solomon/designer.spec.ts
//
// The level designer is sticky (the canvas survives a close or reload), Save
// files a creation by identity rather than by name, and a saved level can be
// continued (Save files over it) or duplicated (a new creation).

import { beforeEach, describe, expect, it } from 'vitest'
import { Designer, STELE_CHEST_TOOLS } from './designer.js'
import { SolomonOverlay } from './overlay.js'
import { emptyLevel, forgetCreations, fromAscii, loadCreations, sanitizeLevel, uniqueCreationName } from './levels.js'
import { COMBAT_SKILLS, EMPTY, WALL } from './engine.js'

beforeEach(() => localStorage.clear())

describe('Solomon designer creations', () => {
  it('restores the canvas exactly as it was left', () => {
    const left = new Designer()
    left.setTool('brick')
    left.paint(5, 5)
    left.level.name = 'Draft'
    left.persist()

    const back = Designer.restore()
    expect(back.level.name).toBe('Draft')
    expect(back.level.tiles).toEqual(left.level.tiles)
    expect(back.tool).toBe('brick')
    expect(back.editingId).toBeNull()
  })

  it('files a new canvas as a new creation and an edited one over itself', () => {
    const d = new Designer()
    d.paint(3, 3)
    const first = d.save('Same name')
    d.newLevel('Same name')
    d.paint(4, 4)
    const second = d.save('Same name')
    expect(second.id).not.toBe(first.id)   // two creations may share a name
    expect(loadCreations()).toHaveLength(2)

    d.edit(loadCreations().find(c => c.id === first.id)!)
    d.paint(6, 6)
    const again = d.save('Renamed')
    expect(again.id).toBe(first.id)
    const all = loadCreations()
    expect(all).toHaveLength(2)
    expect(all.find(c => c.id === first.id)!.level.name).toBe('Renamed')
  })

  it('duplicates into a new creation and leaves the original alone', () => {
    const d = new Designer()
    d.paint(3, 3)
    const original = d.save('Original')
    d.duplicate(original.level, 'Original copy')
    expect(d.editingId).toBeNull()
    d.paint(7, 7)
    const copy = d.save('Original copy')
    expect(copy.id).not.toBe(original.id)
    expect(loadCreations().find(c => c.id === original.id)!.level.tiles).toEqual(original.level.tiles)
  })

  it('knows when replacing the canvas would lose work', () => {
    const d = new Designer()
    expect(d.unsaved([])).toBe(false)
    d.paint(3, 3)
    expect(d.unsaved([])).toBe(true)
    d.edit(d.save('Kept'))
    expect(d.unsaved(loadCreations())).toBe(false)
    d.paint(8, 8)
    expect(d.unsaved(loadCreations())).toBe(true)
  })

  it('gives levels saved before identities an id that holds', () => {
    localStorage.setItem('hc:solomon-levels', JSON.stringify([emptyLevel('Old')]))
    const first = loadCreations()
    expect(first[0]!.id).toMatch(/^[a-f0-9]{64}$/)
    expect(loadCreations()[0]!.id).toBe(first[0]!.id)
  })

  it('forgets only what the delete area destroyed', () => {
    const d = new Designer()
    const a = d.save('A')
    d.newLevel()
    const b = d.save('B')
    expect(forgetCreations(new Set([a.id]))).toBe(1)
    expect(loadCreations().map(c => c.id)).toEqual([b.id])
  })

  it('Save refreshes to a fresh canvas; Creations continues the saved one; the canvas is sticky', () => {
    const button = (text: string, scope: ParentNode = document): HTMLButtonElement =>
      [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
    const nameField = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.sol-name')!

    const overlay = new SolomonOverlay(() => {})
    overlay.mount()
    overlay.showDesigner()
    nameField().value = 'Castle'
    nameField().dispatchEvent(new Event('input'))
    button('Save').click()
    expect(nameField().value).toBe('My Level')   // filed, and a fresh canvas is up

    button('📂 Creations').click()
    const panel = document.querySelector('.sol-creations')!
    expect(panel.textContent).toContain('Castle')
    button('Edit', panel).click()
    expect(nameField().value).toBe('Castle')
    overlay.unmount()

    const reopened = new SolomonOverlay(() => {})
    reopened.mount()
    reopened.showDesigner()
    expect(nameField().value).toBe('Castle')     // sticky: the same canvas comes back
    reopened.unmount()
  })

  it('names new creations without colliding', () => {
    expect(uniqueCreationName('My Level', [])).toBe('My Level')
    expect(uniqueCreationName('My Level', ['My Level', 'My Level 2'])).toBe('My Level 3')
  })
})

// The Hush's own tools (§5.3/(3) §4): six stele/chest tools, one keyed by the
// exact CombatSkillId each grants, plus one 'barrier' tool whose `needs` is
// picked separately (Designer.barrierNeeds) rather than by six more tools.
describe("the Hush's steles, chests and a barrier", () => {
  it('places each of the six stele/chest tools with the skill it grants, on an EMPTY tile', () => {
    const d = new Designer()
    for (const [index, skill] of COMBAT_SKILLS.entries()) {
      const col = 2 + index
      d.setTool(skill)
      expect(d.paint(col, 2)).toBe(true)
      const item = d.level.items.find(i => i.col === col && i.row === 2)!
      expect(item.kind).toBe(STELE_CHEST_TOOLS[skill])
      expect(item.gives).toBe(skill)
      expect(d.level.tiles[2 * d.level.cols + col]).toBe(EMPTY)
    }
  })

  it('places a sealed barrier that paints WALL, not EMPTY, requiring the picked skill', () => {
    const d = new Designer()
    d.setBarrierNeeds('ember')
    d.setTool('barrier')
    expect(d.paint(5, 5)).toBe(true)
    const item = d.level.items.find(i => i.col === 5 && i.row === 5)!
    expect(item.kind).toBe('barrier')
    expect(item.needs).toBe('ember')
    expect(d.level.tiles[5 * d.level.cols + 5]).toBe(WALL)

    d.setBarrierNeeds('hold')
    d.setTool('barrier')
    d.paint(6, 6)
    expect(d.level.items.find(i => i.col === 6 && i.row === 6)!.needs).toBe('hold')
  })

  it('erase strips a stele/chest/barrier and clears its tile back to EMPTY', () => {
    const d = new Designer()
    d.setTool('barrier')
    d.paint(4, 4)
    expect(d.level.tiles[4 * d.level.cols + 4]).toBe(WALL)
    d.setTool('erase')
    d.paint(4, 4)
    expect(d.level.items.some(i => i.col === 4 && i.row === 4)).toBe(false)
    expect(d.level.tiles[4 * d.level.cols + 4]).toBe(EMPTY)
  })

  it('round-trips a chest and a barrier through save + sanitizeLevel', () => {
    const d = new Designer()
    d.setTool('sickle')
    d.paint(3, 3)
    d.setBarrierNeeds('hold')
    d.setTool('barrier')
    d.paint(6, 6)
    const clean = sanitizeLevel(JSON.parse(d.exportJson()))!
    const chest = clean.items.find(i => i.col === 3 && i.row === 3)!
    expect(chest.kind).toBe('chest')
    expect(chest.gives).toBe('sickle')
    expect(chest.needs).toBeUndefined()
    const barrier = clean.items.find(i => i.col === 6 && i.row === 6)!
    expect(barrier.kind).toBe('barrier')
    expect(barrier.needs).toBe('hold')
    expect(barrier.gives).toBeUndefined()
  })

  it('a stele/chest with no real `gives`, or a barrier with no real `needs`, refuses the whole level', () => {
    const base = emptyLevel('bad')
    expect(sanitizeLevel({ ...base, items: [{ col: 1, row: 1, kind: 'stele' }] })).toBeNull()
    expect(sanitizeLevel({ ...base, items: [{ col: 1, row: 1, kind: 'chest', gives: 'not-a-skill' }] })).toBeNull()
    expect(sanitizeLevel({ ...base, items: [{ col: 1, row: 1, kind: 'barrier' }] })).toBeNull()
  })

  it('the ASCII legend places the same six stele/chest glyphs the designer paints, and a barrier rides AsciiOpts.barriers as WALL', () => {
    const level = fromAscii('hush-test', [
      '#######',
      '#AVEH.#',
      '#SQ...#',
      '#P...D#',
      '#######',
    ], { barriers: [{ col: 3, row: 2, needs: 'ember' }] })
    expect(level.items.find(i => i.col === 1 && i.row === 1)).toMatchObject({ kind: 'stele', gives: 'stand' })
    expect(level.items.find(i => i.col === 2 && i.row === 1)).toMatchObject({ kind: 'stele', gives: 'ward' })
    expect(level.items.find(i => i.col === 3 && i.row === 1)).toMatchObject({ kind: 'stele', gives: 'ember' })
    expect(level.items.find(i => i.col === 4 && i.row === 1)).toMatchObject({ kind: 'stele', gives: 'hold' })
    expect(level.items.find(i => i.col === 1 && i.row === 2)).toMatchObject({ kind: 'chest', gives: 'sickle' })
    expect(level.items.find(i => i.col === 2 && i.row === 2)).toMatchObject({ kind: 'chest', gives: 'sling' })
    expect(level.items.find(i => i.col === 3 && i.row === 2)).toMatchObject({ kind: 'barrier', needs: 'ember' })
    expect(level.tiles[2 * level.cols + 3]).toBe(WALL)
  })
})
