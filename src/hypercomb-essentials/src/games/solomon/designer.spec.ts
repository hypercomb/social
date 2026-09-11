// games/solomon/designer.spec.ts
//
// The level designer is sticky (the canvas survives a close or reload), Save
// files a creation by identity rather than by name, and a saved level can be
// continued (Save files over it) or duplicated (a new creation).

import { beforeEach, describe, expect, it } from 'vitest'
import { Designer } from './designer.js'
import { SolomonOverlay } from './overlay.js'
import { emptyLevel, forgetCreations, loadCreations, uniqueCreationName } from './levels.js'

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
