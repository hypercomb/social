// hypercomb-shared/ui/docked-panel/panel-groups.spec.ts
//
// Tool-window GROUPS: a group is just text — matching text shares attributes.
// The chrome that drives this (the header gear and its one text field) lives in
// hc-docked-panel.directive.ts — an Angular directive, so it can't be imported
// under JIT; this covers the model it drives.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  type GroupAttrs, type GroupMember, TEXT_SIZES,
  members, publishAttrs, readGroupAttrs, readMembership, readTextScale, writeMembership, writeTextScale,
} from './panel-groups.js'

/** A tool window as the sharing sees one: a width and a text size, plus its own
 *  limits to clamp an incoming width against — the directive's `adopt`, minus
 *  the DOM. */
class FakeWindow implements GroupMember {
  group = ''
  width: number
  /** `null` = auto, i.e. the scale the panel derives from its own width. */
  text: number | null = null
  constructor(readonly id: string, width: number, readonly max = 680, readonly min = 200) {
    this.width = width
  }
  attrs(): GroupAttrs { return { width: this.width, text: this.text ?? undefined } }
  adopt(attrs: GroupAttrs): void {
    if ('text' in attrs) {
      this.text = attrs.text ?? null
      writeTextScale(this.id, this.text)
    }
    if (attrs.width === undefined) return
    this.width = Math.max(this.min, Math.min(attrs.width, this.max))
  }
  setText(scale: number | null): void {
    this.text = scale
    writeTextScale(this.id, scale)
    if (this.group) publishAttrs(this)
  }
  join(group: string): void {
    this.group = group
    writeMembership(this.id, group)
    const attrs = readGroupAttrs(group)
    if (Object.keys(attrs).length) this.adopt(attrs)
    else publishAttrs(this)
  }
}

const mount = (w: FakeWindow): FakeWindow => { members.add(w); return w }

describe('tool window groups', () => {

  beforeEach(() => {
    members.clear()
    localStorage.clear()
  })

  it('shares a width with every window whose text matches', () => {
    const files = mount(new FakeWindow('files-viewer', 360))
    const tags = mount(new FakeWindow('tags-viewer', 480))

    files.join('reference')                    // first in: defines the width
    expect(readGroupAttrs('reference')).toEqual({ width: 360 })

    tags.join('reference')                     // same text: takes it
    expect(tags.width).toBe(360)

    tags.width = 420                           // a resize travels back
    publishAttrs(tags)
    expect(files.width).toBe(420)
    expect(readGroupAttrs('reference')).toEqual({ width: 420 })
  })

  it('never pushes to windows whose text differs', () => {
    const inA = mount(new FakeWindow('files-viewer', 360))
    const inB = mount(new FakeWindow('tags-viewer', 300))
    const loner = mount(new FakeWindow('observe-viewer', 280))
    inA.join('reference')
    inB.join('Reference')                      // matching is exact — not a match

    inA.width = 500
    publishAttrs(inA)
    expect(inB.width).toBe(300)
    expect(loner.width).toBe(280)
    expect(readGroupAttrs('Reference')).toEqual({ width: 300 })
  })

  it('clamps a shared width to each window\'s own limits', () => {
    const wide = mount(new FakeWindow('files-viewer', 600))
    const narrow = mount(new FakeWindow('tags-viewer', 300, 420))
    wide.join('reference')
    narrow.join('reference')
    expect(narrow.width).toBe(420)
  })

  it('an ungrouped window publishes nothing', () => {
    const loner = mount(new FakeWindow('files-viewer', 360))
    publishAttrs(loner)
    expect(localStorage.getItem('hc:panel-group-attrs:')).toBeNull()
  })

  it('keeps unknown shared attributes when publishing a width', () => {
    localStorage.setItem('hc:panel-group-attrs:reference', JSON.stringify({ width: 300, someFutureAttr: 'kept' }))
    const win = mount(new FakeWindow('files-viewer', 420))
    win.group = 'reference'
    publishAttrs(win)
    expect(readGroupAttrs('reference')).toEqual({ width: 420, someFutureAttr: 'kept' })
  })

  it('shares ONE text size across the group, and back off it again', () => {
    const files = mount(new FakeWindow('files-viewer', 360))
    const tags = mount(new FakeWindow('tags-viewer', 360))
    files.join('reference')
    tags.join('reference')

    files.setText(1.15)                        // set in one member…
    expect(tags.text).toBe(1.15)               // …is the group's size
    expect(readGroupAttrs('reference').text).toBe(1.15)

    files.setText(null)                        // back to auto: the group follows
    expect(tags.text).toBeNull()
    expect(readGroupAttrs('reference').text).toBeUndefined()
  })

  it('a window remembers its own size for when it reopens', () => {
    const loner = mount(new FakeWindow('files-viewer', 360))
    loner.setText(0.85)
    expect(readTextScale('files-viewer')).toBe(0.85)
    expect(localStorage.getItem('hc:panel-group-attrs:')).toBeNull()   // published nothing

    loner.setText(null)
    expect(readTextScale('files-viewer')).toBeNull()
  })

  it('tells "never chose" from "chose Auto"', () => {
    // The distinction a declared default hangs off (hcDockedPanel's
    // `defaultText`): a window that has never been set takes its default,
    // and a window whose participant PICKED auto keeps auto — a reload must
    // not read that back as "no opinion" and hand it the default again.
    expect(readTextScale('notes-strip')).toBeUndefined()

    const notes = mount(new FakeWindow('notes-strip', 500))
    notes.setText(null)                        // an explicit Auto…
    expect(readTextScale('notes-strip')).toBeNull()          // …is a record
    expect(localStorage.getItem('hc:panel-text:notes-strip')).toBe('auto')

    notes.setText(1.15)
    expect(readTextScale('notes-strip')).toBe(1.15)
  })

  it('joining for the width does not retypeset a window the group has no size for', () => {
    const files = mount(new FakeWindow('files-viewer', 360))
    files.join('reference')                    // group now stands for a width only

    const tags = mount(new FakeWindow('tags-viewer', 480))
    tags.setText(1.32)                         // …and this one arrives with a size
    tags.join('reference')
    expect(tags.width).toBe(360)               // takes the width
    expect(tags.text).toBe(1.32)               // keeps its size — the group has none
  })

  it('offers auto plus a ladder of sizes, auto first', () => {
    expect(TEXT_SIZES[0]).toMatchObject({ key: 'auto', scale: null })
    const scales = TEXT_SIZES.slice(1).map(s => s.scale as number)
    expect(scales).toEqual([...scales].sort((a, b) => a - b))
    expect(scales).toContain(1)                // a plain, unscaled size is reachable
  })

  it('remembers the text, trimmed, and clears it when blank', () => {
    writeMembership('files-viewer', 'reference')
    expect(readMembership('files-viewer')).toBe('reference')

    localStorage.setItem('hc:panel-group:tags-viewer', '  reference  ')
    expect(readMembership('tags-viewer')).toBe('reference')

    writeMembership('files-viewer', '')
    expect(localStorage.getItem('hc:panel-group:files-viewer')).toBeNull()
    expect(readMembership('files-viewer')).toBe('')
  })
})
