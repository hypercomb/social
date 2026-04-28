// diamondcoreprocessor.com/recording/recording.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /record — start or stop AI-powered meeting recording.
 *
 * Syntax:
 *   /record              — toggle recording on/off
 *   /record start        — start recording
 *   /record stop         — stop recording
 *   /record interval 30  — set compile interval to 30 seconds
 *   /record model haiku  — set AI model (haiku, sonnet, opus)
 */
export class RecordingQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'recording'
  readonly command = 'record'
  override readonly aliases = []
  override description = 'Start AI-powered meeting recording with live hierarchy compilation'
  override descriptionKey = 'slash.record'

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const options = ['start', 'stop', 'interval', 'model']
    if (!q) return options
    return options.filter(s => s.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase()

    if (!trimmed || trimmed === 'start' || trimmed === 'stop') {
      // determine meeting cell from selection
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string> } | undefined
      const selectedLabels = selection ? Array.from(selection.selected) : []

      if (trimmed === 'stop') {
        EffectBus.emit('recording:toggle', { cell: selectedLabels[0] })
        return
      }

      // toggle or start
      EffectBus.emit('recording:toggle', { cell: selectedLabels[0] })
      return
    }

    // /record interval <seconds>
    if (trimmed.startsWith('interval')) {
      const seconds = parseInt(trimmed.replace('interval', '').trim(), 10)
      if (isNaN(seconds) || seconds < 5) {
        console.warn('[/record] Interval must be at least 5 seconds')
        return
      }
      EffectBus.emit('recording:configure', { compileIntervalMs: seconds * 1000 })
      console.log(`[/record] Compile interval set to ${seconds}s`)
      return
    }

    // /record model <name>
    if (trimmed.startsWith('model')) {
      const model = trimmed.replace('model', '').trim()
      if (!model) {
        console.warn('[/record] Usage: /record model haiku|sonnet|opus')
        return
      }
      EffectBus.emit('recording:configure', { model })
      console.log(`[/record] AI model set to ${model}`)
      return
    }

    console.warn(`[/record] Unknown argument: ${trimmed}`)
  }
}

const _recording = new RecordingQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RecordingQueenBee', _recording)
