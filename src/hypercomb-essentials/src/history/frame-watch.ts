// history/frame-watch.ts
//
// WHAT THE PAGE DID WHEN IT RAN.
//
// A site's page runs in a sandboxed frame (revision-viewer.model.ts): no
// network, no storage, no way to the hive. A model that writes one of the
// page's files could not see the result. It wrote a script, was told the
// file was written, and went on; whether the page then threw, drew nothing
// or lost its pictures was found only by a person looking. Linking six
// creations to the back of a card took two such reports from outside before
// it worked (business-card.jwize.com, 2026-11-15: `contentOf` and `compact`
// both dropped the new field, and nothing in the hive said so).
//
// So the frame watches itself. `FRAME_WATCH` runs in the frame before any of
// the page's own code and keeps what goes wrong: an uncaught error, a
// rejected promise nobody caught, a `console.error` or `console.warn`, a
// script or picture that did not load, a request the frame's policy
// refused, a canvas that could not get a context. Asked by its parent, it
// answers with those and with what the page shows: its text, how many
// pictures loaded, its canvases and what was drawn into them.
//
// It reports and nothing else: it changes nothing the page does, it reads
// nothing the page did not put on screen or in the console, and it answers
// only the window that holds the frame.
//
// `askFrame` is the parent's side. `frameReportWords` says a report in plain
// lines, which is what a model is handed after its write.

/** One thing that went wrong while the page ran. */
export type FrameTrouble = {
  /** `error`, `rejection`, `console.error`, `console.warn`, `load`, `refused`, `canvas`. */
  readonly kind: string
  readonly message: string
  /** Where, when the browser said: a line in the page, a script's signature. */
  readonly where?: string
}

export type FrameReport = {
  /** Milliseconds since the page started. */
  readonly ran: number
  readonly errors: readonly FrameTrouble[]
  /** Troubles past the ones kept. */
  readonly more: number
  /** The page's visible text, shortened; `textChars` is its whole length. */
  readonly text: string
  readonly textChars: number
  readonly images: { readonly loaded: number; readonly failed: number }
  /** Each canvas, the kind of context it holds (or the kind it asked for and
   *  was refused), and how many draw calls it took. */
  readonly canvases: readonly { readonly width: number; readonly height: number; readonly context: string; readonly asked?: string; readonly draws: number }[]
  readonly elements: number
}

/** Troubles one page keeps; each message this long. */
const KEPT = 12
const MESSAGE = 300

// Runs in the frame, first. Plain ES5 on purpose: it must run before, and
// whatever, the page's own code is.
export const FRAME_WATCH = `(function () {
  var started = Date.now(), troubles = [], dropped = 0;
  function note(kind, message, where) {
    if (troubles.length >= ${KEPT}) { dropped++; return; }
    var said = '';
    try { said = String(message == null ? '' : message); } catch (x) { said = 'unprintable'; }
    troubles.push({ kind: kind, message: said.slice(0, ${MESSAGE}), where: where ? String(where).slice(0, 120) : '' });
  }
  function words(value) {
    if (value && value.message) return value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (x) { return String(value); }
  }
  addEventListener('error', function (e) {
    var target = e.target;
    if (target && target !== window && target.tagName) {
      var sig = target.getAttribute ? (target.getAttribute('data-hc-script') || '') : '';
      note('load', 'a ' + String(target.tagName).toLowerCase() + ' did not load', sig ? 'script ' + sig.slice(0, 12) : '');
      return;
    }
    note('error', e.message || (e.error && e.error.message) || 'a script error', e.lineno ? 'line ' + e.lineno + (e.colno ? ':' + e.colno : '') + ' of the page' : '');
  }, true);
  addEventListener('unhandledrejection', function (e) { note('rejection', words(e.reason), ''); });
  addEventListener('securitypolicyviolation', function (e) {
    note('refused', 'the frame refused ' + String(e.violatedDirective || 'a request') + (e.blockedURI ? ' for ' + String(e.blockedURI).slice(0, 60) : ''), '');
  });
  ['error', 'warn'].forEach(function (level) {
    var was = console[level];
    if (typeof was !== 'function') return;
    console[level] = function () {
      try { note('console.' + level, Array.prototype.map.call(arguments, words).join(' '), ''); } catch (x) {}
      return was.apply(console, arguments);
    };
  });
  // A canvas says what it was asked for and how often it was drawn into: a
  // page that made a canvas and drew nothing is a blank page with no error.
  try {
    var getContext = HTMLCanvasElement.prototype.getContext;
    var counted = ['drawImage', 'fillRect', 'fillText', 'strokeText', 'stroke', 'fill', 'putImageData', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];
    HTMLCanvasElement.prototype.getContext = function (kind) {
      var context = getContext.apply(this, arguments);
      var canvas = this;
      try {
        // Asked and refused is kept, not reported at once: a page asks for
        // webgl2 and falls back to webgl, and that is not a problem.
        if (!context) { canvas.__hcAsked = String(kind); return context; }
        if (!canvas.__hcKind) {
          canvas.__hcKind = String(kind);
          canvas.__hcDraws = 0;
          counted.forEach(function (name) {
            var was = context[name];
            if (typeof was !== 'function') return;
            context[name] = function () { canvas.__hcDraws++; return was.apply(context, arguments); };
          });
        }
      } catch (x) {}
      return context;
    };
  } catch (x) {}
  addEventListener('message', function (e) {
    if (!e.data || e.data.hcRevisionAsk !== 'report' || e.source !== parent) return;
    var text = '';
    try { text = String(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim(); } catch (x) {}
    var images = Array.prototype.slice.call(document.images || []);
    var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas')).slice(0, 6).map(function (c) {
      return { width: c.width, height: c.height, context: c.__hcKind || '', asked: c.__hcKind ? '' : (c.__hcAsked || ''), draws: c.__hcDraws || 0 };
    });
    try {
      parent.postMessage({ hcRevisionReport: {
        id: e.data.id, ran: Date.now() - started, errors: troubles.slice(), more: dropped,
        text: text.slice(0, 1200), textChars: text.length,
        images: {
          loaded: images.filter(function (i) { return i.complete && i.naturalWidth > 0; }).length,
          failed: images.filter(function (i) { return i.complete && !i.naturalWidth; }).length
        },
        canvases: canvases, elements: document.querySelectorAll('*').length
      } }, '*');
    } catch (x) {}
  });
})();`

const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const str = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : ''

/** A report as the frame sent it, read as untrusted page data. Null when it
 *  is not one. */
export const readFrameReport = (raw: unknown): FrameReport | null => {
  if (!raw || typeof raw !== 'object') return null
  const report = raw as Record<string, unknown>
  if (!Array.isArray(report['errors'])) return null
  const images = (report['images'] ?? {}) as Record<string, unknown>
  return {
    ran: num(report['ran']),
    errors: (report['errors'] as unknown[]).slice(0, KEPT).flatMap(entry => {
      if (!entry || typeof entry !== 'object') return []
      const trouble = entry as Record<string, unknown>
      const where = str(trouble['where'], 120)
      return [{ kind: str(trouble['kind'], 32) || 'error', message: str(trouble['message'], MESSAGE), ...(where ? { where } : {}) }]
    }),
    more: num(report['more']),
    text: str(report['text'], 1200),
    textChars: num(report['textChars']),
    images: { loaded: num(images['loaded']), failed: num(images['failed']) },
    canvases: (Array.isArray(report['canvases']) ? report['canvases'] as unknown[] : []).slice(0, 6).flatMap(entry => {
      if (!entry || typeof entry !== 'object') return []
      const canvas = entry as Record<string, unknown>
      const asked = str(canvas['asked'], 24)
      return [{ width: num(canvas['width']), height: num(canvas['height']), context: str(canvas['context'], 24), ...(asked ? { asked } : {}), draws: num(canvas['draws']) }]
    }),
    elements: num(report['elements']),
  }
}

let asks = 0

/**
 * Ask a frame what its page did. Resolves with its report, or null when it
 * does not answer in time (a page from before the watch, a frame that is
 * gone). Only an answer from that frame's own window, to this question, is
 * taken.
 */
export const askFrame = (frame: HTMLIFrameElement, timeoutMs = 1500): Promise<FrameReport | null> =>
  new Promise(resolve => {
    const target = frame.contentWindow
    if (!target) { resolve(null); return }
    const id = `ask-${++asks}-${Date.now()}`
    let done = false
    const finish = (report: FrameReport | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      removeEventListener('message', heard)
      resolve(report)
    }
    const heard = (event: MessageEvent): void => {
      if (event.source !== target) return
      const sent = (event.data as { hcRevisionReport?: unknown } | null)?.hcRevisionReport
      if (!sent || (sent as { id?: unknown }).id !== id) return
      finish(readFrameReport(sent))
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    addEventListener('message', heard)
    try { target.postMessage({ hcRevisionAsk: 'report', id }, '*') } catch { finish(null) }
  })

const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * A report in plain lines, as a model is told it after a write. Troubles
 * first, because they are what to act on; then what the page shows.
 */
export const frameReportWords = (report: FrameReport): string[] => {
  const lines: string[] = []
  const troubles = report.errors.length + report.more
  lines.push(troubles
    ? `The page ran for ${seconds(report.ran)} and reported ${count(troubles, 'problem', 'problems')}:`
    : `The page ran for ${seconds(report.ran)} and reported no errors.`)
  for (const trouble of report.errors) {
    lines.push(`- ${trouble.kind}: ${trouble.message || 'no message'}${trouble.where ? ` (${trouble.where})` : ''}`)
  }
  if (report.more) lines.push(`- and ${report.more} more that were not kept.`)

  if (report.textChars) {
    const cut = report.textChars > report.text.length ? `, the first ${report.text.length} of ${report.textChars} characters` : ''
    lines.push(`It shows this text${cut}: “${report.text}”`)
  } else {
    lines.push('It shows no text.')
  }
  if (report.images.loaded || report.images.failed) {
    lines.push(`Pictures: ${report.images.loaded} loaded${report.images.failed ? `, ${report.images.failed} did not` : ''}.`)
  }
  for (const canvas of report.canvases) {
    const size = `${canvas.width}×${canvas.height}`
    lines.push(!canvas.context
      ? canvas.asked
        ? `A ${size} canvas asked for a ${canvas.asked} context and got none.`
        : `A ${size} canvas was never given a context.`
      : !canvas.draws
        ? `A ${size} canvas (${canvas.context}) has had nothing drawn into it.`
        : `A ${size} canvas (${canvas.context}) took ${count(canvas.draws, 'draw call', 'draw calls')}.`)
  }
  return lines
}
