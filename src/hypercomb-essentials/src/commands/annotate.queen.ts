// commands/annotate.queen.ts
//
// /annotate — draw on the screen you are looking at.
//
// The sheet (hypercomb-shared/ui/markup-overlay) takes ink over the whole app,
// photographs the screen WITH the ink in it, and hands the picture to the chat
// — either onto the open conversation's shelf, or as a NEW conversation about
// the location you were standing on when you drew.
//
// It used to be a button in the corner of the notes desk, which made annotating
// something you did while writing notes. It is the opposite: you annotate the
// screen in front of you, and the notes desk is one of the things that might be
// on it. Hence a word, a rail button, and the `d` key — three doors, one act.
//
// NO `machine` GRAMMAR, deliberately: drawing is a hand, and the browser will
// only share a screen in answer to a real gesture. A model calling this would
// open a sheet nobody is holding a pen over.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class AnnotateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'annotate'
  override description = 'Draw on the screen and send it to chat'
  override descriptionKey = 'slash.annotate'
  override examples = [
    { input: '/annotate', result: 'Opens the drawing sheet over the screen' },
  ]

  protected execute(): void {
    // No arguments: the sheet reads WHERE it was opened from the hive itself,
    // which is the only address anyone has ever wanted for it.
    EffectBus.emit('markup:open', {})
  }
}

const _annotate = new AnnotateQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/AnnotateQueenBee', _annotate)
