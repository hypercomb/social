// hypercomb-shared/ui/docked-panel/panel-groups.spec.ts
//
// Tool-window GROUPS: a group is just text — matching text shares attributes.
// The chrome that drives this (the header gear and its one text field) lives in
// hc-docked-panel.directive.ts — an Angular directive, so it can't be imported
// under JIT; this covers the model it drives.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  type GroupAttrs, type GroupMember,
  members, publishAttrs, readGroupAttrs, readMembership, writeMembership,
} from './panel-groups'

/** A tool window as the sharing sees one: a width, and its own limits to clamp
 *  an incoming one against — the directive's `adopt`, minus the DOM. */
class FakeWindow implements GroupMember {
  group = ''
  width: number
  constructor(readonly id: string, width: number, readonly max = 680, readonly min = 200) {
    this.width = width
  }
  attrs(): GroupAttrs { return { width: this.width } }
  adopt(attrs: GroupAttrs): void {
    if (attrs.width === undefined) return
    this.width = Math.max(this.min, Math.min(attrs.width, this.max))
  }
  join(group: string): void {
    this.group = group
    writeMembership(this.id, group)
    const attrs = readGroupAttrs(group)
    if (attrs.width !== undefined) this.adopt(attrs)
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
