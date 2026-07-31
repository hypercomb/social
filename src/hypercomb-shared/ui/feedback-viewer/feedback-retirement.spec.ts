import { describe, expect, it } from 'vitest'
import {
  feedbackMatchesReach,
  indexFeedbackRetirements,
  questionWasAnswered,
  visibleFeedbackItems,
} from './feedback-retirement'

const qaSig = 'a'.repeat(64)
const hiddenSig = 'b'.repeat(64)
const seenSig = 'c'.repeat(64)
const answerSig = 'd'.repeat(64)

describe('feedback inbox retirement', () => {
  it('keeps replayed feedback retired by both content signature and stable id', () => {
    const index = indexFeedbackRetirements([
      {
        sig: hiddenSig,
        value: {
          kind: 'hidden',
          payload: { targetKind: 'feedback-item', targetSig: qaSig.toUpperCase() },
        },
      },
      {
        sig: seenSig,
        value: { kind: 'feedback-seen', payload: { key: 'fb-stable-id' } },
      },
    ])

    expect(index.hiddenByTarget.get(qaSig)).toBe(hiddenSig)
    expect(index.seenByKey.get('fb-stable-id')).toBe(seenSig)
  })

  it('closes a replayed question when its answer references the question sig', () => {
    const index = indexFeedbackRetirements([
      {
        sig: answerSig,
        value: { kind: 'qa-answer', payload: { qSig: qaSig, qId: 'q-original' } },
      },
    ])

    expect(questionWasAnswered(index, qaSig, 'q-other')).toBe(true)
  })

  it('closes duplicate question bytes when they carry the already-answered qId', () => {
    const index = indexFeedbackRetirements([
      {
        sig: answerSig,
        value: { kind: 'qa-answer', payload: { qId: 'q-stable' } },
      },
    ])

    expect(questionWasAnswered(index, 'e'.repeat(64), 'q-stable')).toBe(true)
    expect(questionWasAnswered(index, 'e'.repeat(64), 'q-new')).toBe(false)
  })

  it('stays closed after the routine drains and removes the qa-answer', () => {
    const index = indexFeedbackRetirements([
      {
        sig: answerSig,
        value: { kind: 'qa-answered', payload: { qSig: qaSig, qId: 'q-drained' } },
      },
    ])

    expect(questionWasAnswered(index, qaSig, 'q-drained')).toBe(true)
  })

  it('projects an empty inbox when every item is retired and Show hidden is off', () => {
    const items = [
      { id: 'one', retired: true },
      { id: 'two', retired: true },
    ]

    expect(visibleFeedbackItems(items, false, item => item.retired)).toEqual([])
    expect(visibleFeedbackItems(items, true, item => item.retired)).toEqual(items)
  })

  it('swaps page-addressed messages as This page navigation changes', () => {
    const items = [
      { kind: 'feedback', route: 'alpha', text: 'for alpha' },
      { kind: 'qa', route: 'beta', text: 'for beta' },
      { kind: 'reply', route: '', text: 'unscoped reply' },
    ]
    const at = (route: string): string[] => items
      .filter(item => feedbackMatchesReach(item, 'local', route))
      .map(item => item.text)

    expect(at('alpha')).toEqual(['for alpha', 'unscoped reply'])
    expect(at('beta')).toEqual(['for beta', 'unscoped reply'])
  })

  it('includes descendants only in the children reach', () => {
    const child = { kind: 'feedback', route: 'alpha/child' }

    expect(feedbackMatchesReach(child, 'local', 'alpha')).toBe(false)
    expect(feedbackMatchesReach(child, 'children', 'alpha')).toBe(true)
    expect(feedbackMatchesReach(child, 'global', 'elsewhere')).toBe(true)
  })
})
