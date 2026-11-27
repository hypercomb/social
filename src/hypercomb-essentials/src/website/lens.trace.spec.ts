// website/lens.trace.spec.ts
import { describe, expect, it } from 'vitest'
import { siteOf, traceRender } from './lens.trace.js'

describe('siteOf', () => {
  it('names the code that called the first trace wrapper', () => {
    const stack = [
      'Error',
      '    at HTMLElement.__lensTraceSet [as className] (http://localhost:4250/chunk-A.js:9:100)',
      '    at #head (http://localhost:4250/chunk-N2WSI2AJ.js:117:20)',
      '    at #render (http://localhost:4250/chunk-N2WSI2AJ.js:113:37)',
    ].join('\n')
    expect(siteOf(stack)).toEqual({ url: 'http://localhost:4250/chunk-N2WSI2AJ.js', line: 117, column: 20, fn: '#head' })
  })

  it('answers nothing for a stack no wrapper is on', () => {
    expect(siteOf('Error\n    at f (http://x/a.js:1:1)')).toBeNull()
  })
})

describe('traceRender', () => {
  it('records what was done to each node and puts every method back', async () => {
    const create = Document.prototype.createElement
    const listen = EventTarget.prototype.addEventListener
    const className = Object.getOwnPropertyDescriptor(Element.prototype, 'className')
    let made: HTMLElement | null = null
    const trace = await traceRender(() => {
      made = document.createElement('button')
      made.className = 'go'
      made.setAttribute('aria-label', 'Go')
      made.classList.toggle('on', true)
      made.addEventListener('click', () => {})
      document.body.appendChild(made)
    })
    const kinds = (trace.ops.get(made!) ?? []).map(op => `${op.kind}${'name' in op ? `:${op.name}` : ''}`)
    expect(kinds).toEqual(['create', 'set:className', 'attr:aria-label', 'class:toggle', 'listen:click'])
    expect(trace.placed.has(made!)).toBe(true)
    // The watched DOM is the platform's own again.
    expect(Document.prototype.createElement).toBe(create)
    expect(EventTarget.prototype.addEventListener).toBe(listen)
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'className')).toEqual(className)
    made!.remove()
  })

  it('puts everything back when the drawing throws', async () => {
    const create = Document.prototype.createElement
    await expect(traceRender(() => { throw new Error('broke') })).rejects.toThrow('broke')
    expect(Document.prototype.createElement).toBe(create)
  })
})
