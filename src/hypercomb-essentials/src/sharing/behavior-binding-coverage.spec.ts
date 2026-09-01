// behavior-binding-coverage.spec.ts — WHERE A BINDING REACHES.
//
// The rules this file guards (Jaime, 2026-08-20):
//   1. A binding covers the bound tile and its subtree (as before).
//   2. A binding ALSO covers the layer the bound tile SITS ON — its parent.
//      The tile renders there (the post-it's sticky takes over its hexagon on
//      that layer), so that layer's Beehaviors list must name the behaviour
//      instead of withdrawing it as "bound elsewhere".
//   3. Nowhere else: a bound behaviour stays withdrawn on sibling tiles, on
//      unrelated branches, and above the parent — a relationship scopes the
//      behaviour, it never spreads it to every page.
//   4. A binding you are standing inside wins over one merely sitting beside
//      you when both could answer.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  bindBehaviorTo, bindingAt, isWithdrawnByBinding, isBehaviorDormant,
  seedGlobalOnKinds, ENABLEMENT_CHANGED,
} from './behavior-enablement.js'

const KIND = 'visual:postit:note'

beforeEach(() => {
  localStorage.clear()
  // The lens caches drop on the change event — clearing storage alone would
  // leave a previous test's bindings readable.
  EffectBus.emit(ENABLEMENT_CHANGED, {})
  // Light the kind globally so dormancy answers reflect the BINDING alone.
  seedGlobalOnKinds([KIND])
})

describe('where a behaviour binding reaches', () => {

  it('covers the bound tile and its subtree', () => {
    bindBehaviorTo(KIND, { sig: 'loc:meetup', path: '/revolucion/meetup', name: 'meetup' })
    expect(bindingAt(KIND, ['revolucion', 'meetup'])?.sig).toBe('loc:meetup')
    expect(bindingAt(KIND, ['revolucion', 'meetup', 'agenda'])?.sig).toBe('loc:meetup')
  })

  it('covers the layer the bound tile sits on — the sticky renders there', () => {
    bindBehaviorTo(KIND, { sig: 'loc:meetup', path: '/revolucion/meetup', name: 'meetup' })
    expect(bindingAt(KIND, ['revolucion'])?.sig).toBe('loc:meetup')
    expect(isWithdrawnByBinding(KIND, ['revolucion'])).toBe(false)
    expect(isBehaviorDormant(KIND, ['revolucion'])).toBe(false)
  })

  it('a root-level tile binding covers the hive root layer', () => {
    bindBehaviorTo(KIND, { sig: 'loc:meetup', path: '/meetup', name: 'meetup' })
    expect(bindingAt(KIND, [])?.sig).toBe('loc:meetup')
    expect(isWithdrawnByBinding(KIND, [])).toBe(false)
  })

  it('stays withdrawn everywhere else — siblings, other branches, above the parent', () => {
    bindBehaviorTo(KIND, { sig: 'loc:meetup', path: '/revolucion/meetup', name: 'meetup' })
    for (const elsewhere of [
      ['revolucion', 'wholesale'],   // sibling tile on the same layer
      ['garden'],                    // unrelated branch
      [],                            // above the parent (the hive root)
    ]) {
      expect(bindingAt(KIND, elsewhere)).toBeUndefined()
      expect(isWithdrawnByBinding(KIND, elsewhere)).toBe(true)
      expect(isBehaviorDormant(KIND, elsewhere)).toBe(true)
    }
  })

  it('a binding you stand inside wins over one sitting beside you', () => {
    // /a is a bound tile itself AND the layer /a/b sits on — standing at /a,
    // the binding that covers you is /a's own, not the neighbour's.
    bindBehaviorTo(KIND, { sig: 'loc:b', path: '/a/b', name: 'b' })
    bindBehaviorTo(KIND, { sig: 'loc:a', path: '/a', name: 'a' })
    expect(bindingAt(KIND, ['a'])?.sig).toBe('loc:a')
  })
})
