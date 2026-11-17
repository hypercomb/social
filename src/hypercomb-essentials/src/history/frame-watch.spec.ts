// frame-watch.spec.ts — what the page did when it ran: the watch that runs
// in the frame, the question its parent asks, and the report in plain lines.

import { afterEach, describe, expect, it } from 'vitest'
import { FRAME_WATCH, askFrame, frameReportWords, readFrameReport, type FrameReport } from './frame-watch.js'

const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }

const base: FrameReport = {
  ran: 1234, errors: [], more: 0, text: 'Jaime Weise Ask them to point their camera here', textChars: 47,
  images: { loaded: 5, failed: 0 }, canvases: [], elements: 80,
}

describe('a report in plain lines', () => {
  it('says a clean run, the text it shows and its pictures', () => {
    expect(frameReportWords(base)).toEqual([
      'The page ran for 1.2 s and reported no errors.',
      'It shows this text: “Jaime Weise Ask them to point their camera here”',
      'Pictures: 5 loaded.',
    ])
  })

  it('puts the problems first, each with its kind and where', () => {
    const words = frameReportWords({
      ...base,
      errors: [
        { kind: 'error', message: 'Uncaught TypeError: links is not iterable', where: 'line 214:9 of the page' },
        { kind: 'console.error', message: 'texture missing' },
      ],
      more: 3, images: { loaded: 2, failed: 1 },
    })
    expect(words.slice(0, 4)).toEqual([
      'The page ran for 1.2 s and reported 5 problems:',
      '- error: Uncaught TypeError: links is not iterable (line 214:9 of the page)',
      '- console.error: texture missing',
      '- and 3 more that were not kept.',
    ])
    expect(words.at(-1)).toBe('Pictures: 2 loaded, 1 did not.')
  })

  it('says a page that shows nothing, and what each canvas took', () => {
    const words = frameReportWords({
      ...base, text: '', textChars: 0, images: { loaded: 0, failed: 0 },
      canvases: [
        { width: 640, height: 480, context: 'webgl2', draws: 5400 },
        { width: 300, height: 150, context: '2d', draws: 0 },
        { width: 300, height: 150, context: '', asked: 'webgl2', draws: 0 },
        { width: 10, height: 10, context: '', draws: 0 },
      ],
    })
    expect(words).toEqual([
      'The page ran for 1.2 s and reported no errors.',
      'It shows no text.',
      'A 640×480 canvas (webgl2) took 5400 draw calls.',
      'A 300×150 canvas (2d) has had nothing drawn into it.',
      'A 300×150 canvas asked for a webgl2 context and got none.',
      'A 10×10 canvas was never given a context.',
    ])
  })

  it('says how much of a long text is shown', () => {
    expect(frameReportWords({ ...base, text: 'abc', textChars: 4000 })[1]).toBe('It shows this text, the first 3 of 4000 characters: “abc”')
  })
})

describe('a report as the frame sent it', () => {
  it('is read as page data: bounded, typed, and nothing else kept', () => {
    const read = readFrameReport({
      ran: '12', errors: [{ kind: 5, message: 'x'.repeat(900), where: 7, extra: 'no' }, 'not one', null, ...Array.from({ length: 40 }, () => ({ kind: 'error', message: 'm' }))],
      more: 2, text: 'y'.repeat(5000), textChars: 5000, images: { loaded: 3, failed: 'many' },
      canvases: [{ width: 8, height: 9, context: 'webgl', draws: 4, secret: 1 }], elements: 12, also: 'ignored',
    })!
    expect(read.ran).toBe(0)
    expect(read.errors).toHaveLength(10)
    expect(read.errors[0]).toEqual({ kind: 'error', message: 'x'.repeat(300) })
    expect(read.text).toHaveLength(1200)
    expect(read.images).toEqual({ loaded: 3, failed: 0 })
    expect(read.canvases).toEqual([{ width: 8, height: 9, context: 'webgl', draws: 4 }])
    expect(Object.keys(read).sort()).toEqual(['canvases', 'elements', 'errors', 'images', 'more', 'ran', 'text', 'textChars'])
  })

  it('is nothing when it is not a report', () => {
    for (const raw of [null, 'text', 5, {}, { errors: 'none' }]) expect(readFrameReport(raw)).toBeNull()
  })
})

describe('the watch that runs in the frame', () => {
  // Run in this window, as it runs in a frame's: here the window is its own
  // parent, so the question is asked by the window that holds it.
  const asked = async (): Promise<FrameReport> => {
    const heard = new Promise<unknown>(resolve => {
      const listen = (event: MessageEvent): void => {
        const report = (event.data as { hcRevisionReport?: unknown } | null)?.hcRevisionReport
        if (!report) return
        removeEventListener('message', listen)
        resolve(report)
      }
      addEventListener('message', listen)
    })
    dispatchEvent(new MessageEvent('message', { data: { hcRevisionAsk: 'report', id: 'q1' }, source: window }))
    return readFrameReport(await heard)!
  }
  const quiet = { error: console.error, warn: console.warn }
  afterEach(() => { console.error = quiet.error; console.warn = quiet.warn })

  it('keeps what went wrong and says what the page shows', async () => {
    console.error = () => {}
    console.warn = () => {}
    document.body.innerHTML = '<p>the   card</p><canvas width="64" height="32"></canvas>'
    // jsdom has no layout: innerText is what a browser computes from it.
    Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => document.body.textContent })
    new Function(FRAME_WATCH)()

    dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: links is not iterable', lineno: 214, colno: 9 }))
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown }
    rejection.reason = new Error('no bytes for that signature')
    dispatchEvent(rejection)
    console.error('texture missing', { sig: 'abc' })
    console.warn('slow frame')
    const script = document.createElement('script')
    script.setAttribute('data-hc-script', 'f'.repeat(64))
    document.body.appendChild(script)
    script.dispatchEvent(new Event('error'))

    const report = await asked()
    expect(report.errors).toEqual([
      { kind: 'error', message: 'Uncaught TypeError: links is not iterable', where: 'line 214:9 of the page' },
      { kind: 'rejection', message: 'no bytes for that signature' },
      { kind: 'console.error', message: 'texture missing {"sig":"abc"}' },
      { kind: 'console.warn', message: 'slow frame' },
      { kind: 'load', message: 'a script did not load', where: 'script ffffffffffff' },
    ])
    expect(report.text).toBe('the card')
    expect(report.canvases).toEqual([{ width: 64, height: 32, context: '', draws: 0 }])
    expect(report.ran).toBeGreaterThanOrEqual(0)
  })

  it('answers only the window that holds it, and only that question', async () => {
    let answers = 0
    const count = (event: MessageEvent): void => { if ((event.data as { hcRevisionReport?: unknown } | null)?.hcRevisionReport) answers++ }
    addEventListener('message', count)
    dispatchEvent(new MessageEvent('message', { data: { hcRevisionAsk: 'report', id: 'x' }, source: null }))
    dispatchEvent(new MessageEvent('message', { data: { hcRevisionAsk: 'everything', id: 'x' }, source: window }))
    dispatchEvent(new MessageEvent('message', { data: 'report', source: window }))
    await settle()
    removeEventListener('message', count)
    expect(answers).toBe(0)
  })

  it('cannot end the script it is written into', () => {
    expect(FRAME_WATCH).not.toMatch(/<\/script/i)
    expect(FRAME_WATCH).not.toContain('`')
    expect(() => new Function(FRAME_WATCH)).not.toThrow()
  })
})

describe('asking a frame', () => {
  const frameWith = (answer: (data: { id: string }, source: Window) => void): HTMLIFrameElement => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const inner = frame.contentWindow!
    inner.postMessage = ((data: { id: string }) => { queueMicrotask(() => answer(data, inner)) }) as typeof inner.postMessage
    return frame
  }

  it('takes the answer to its own question from that frame’s own window', async () => {
    const frame = frameWith((data, source) => {
      // An answer from elsewhere, and one to another question, are not it.
      dispatchEvent(new MessageEvent('message', { data: { hcRevisionReport: { id: data.id, errors: [], ran: 1 } }, source: window }))
      dispatchEvent(new MessageEvent('message', { data: { hcRevisionReport: { id: 'other', errors: [], ran: 2 } }, source }))
      dispatchEvent(new MessageEvent('message', { data: { hcRevisionReport: { id: data.id, errors: [], ran: 3 } }, source }))
    })
    expect((await askFrame(frame, 200))?.ran).toBe(3)
    frame.remove()
  })

  it('is nothing when the frame does not answer in time', async () => {
    const frame = frameWith(() => {})
    expect(await askFrame(frame, 30)).toBeNull()
    frame.remove()
  })
})
