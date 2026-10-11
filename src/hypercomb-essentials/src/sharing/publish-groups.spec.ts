// publish-groups.spec.ts — PUBLISH GROUPS, the pure half: a group is its
// record on the layer (appearance) plus the mark its members wear (identity),
// and one tap joins the selection or, when it is all in already, takes it out.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_ICON, GROUP_COLORS, PUBLISH_GROUP_KIND,
  decideTap, groupsInSlotOrder, newGroupMeaning, nextGroupColor, parseGroupPayload,
} from './publish-groups.js'

describe('parseGroupPayload', () => {
  it('reads a whole record', () => {
    expect(parseGroupPayload({ meaning: 'publish:abc', name: 'Blog', icon: 'star', color: '#3ddc84' }))
      .toEqual({ meaning: 'publish:abc', name: 'Blog', icon: 'star', color: '#3ddc84' })
  })

  it('refuses a meaning outside the publish family — another feature\'s group is not ours', () => {
    expect(parseGroupPayload({ meaning: 'host:example.com', name: 'x' })).toBeNull()
    expect(parseGroupPayload({ meaning: 'publish:', name: 'x' })).toBeNull()
    expect(parseGroupPayload(null)).toBeNull()
  })

  it('falls back to the default glyph and the first colour rather than painting nonsense', () => {
    expect(parseGroupPayload({ meaning: 'publish:a', icon: '', color: 'red' }))
      .toEqual({ meaning: 'publish:a', name: '', icon: DEFAULT_GROUP_ICON, color: GROUP_COLORS[0] })
  })
})

describe('groupsInSlotOrder', () => {
  const rec = (sig: string, meaning: string, name: string) =>
    ({ sig, kind: PUBLISH_GROUP_KIND, payload: { meaning, name, icon: 'label', color: '#48c6ff' } })

  it('keeps one group per meaning, the LATER record winning, in first-seen position', () => {
    const groups = groupsInSlotOrder([
      rec('s1', 'publish:a', 'Alpha'),
      rec('s2', 'publish:b', 'Beta'),
      rec('s3', 'publish:a', 'Alpha renamed'),
    ])
    expect(groups.map(g => [g.meaning, g.name, g.recordSig])).toEqual([
      ['publish:a', 'Alpha renamed', 's3'],
      ['publish:b', 'Beta', 's2'],
    ])
  })

  it('ignores every other kind on the layer', () => {
    expect(groupsInSlotOrder([{ sig: 'x', kind: 'publish:groups', payload: {} }, { sig: 'y', kind: 'group', payload: {} }]))
      .toEqual([])
  })
})

describe('decideTap', () => {
  it('joins the selected tiles that are not in the group yet', () => {
    expect(decideTap(['a', 'b', 'c'], new Set(['b']))).toEqual({ join: ['a', 'c'], leave: [] })
  })

  it('takes them out when every selected tile is already in', () => {
    expect(decideTap(['a', 'b'], new Set(['a', 'b', 'z']))).toEqual({ join: [], leave: ['a', 'b'] })
  })

  it('does nothing with nothing selected', () => {
    expect(decideTap([], new Set(['a']))).toEqual({ join: [], leave: [] })
  })
})

describe('nextGroupColor', () => {
  it('takes the first colour the layer is not wearing, then wraps', () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0])
    expect(nextGroupColor([GROUP_COLORS[0].toUpperCase()])).toBe(GROUP_COLORS[1])
    expect(nextGroupColor([...GROUP_COLORS])).toBe(GROUP_COLORS[0])
  })
})

describe('newGroupMeaning', () => {
  it('is scoped to the publish family and differs call to call', () => {
    const a = newGroupMeaning(() => 0.1, () => 1)
    const b = newGroupMeaning(() => 0.2, () => 1)
    expect(a.startsWith('publish:')).toBe(true)
    expect(a).not.toBe(b)
  })
})
