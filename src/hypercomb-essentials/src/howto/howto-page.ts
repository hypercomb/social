// howto/howto-page.ts
//
// A HOW-TO PAGE FOR EVERY WORD (jwize, 2026-10-25: "every beehavior needs to
// have a how to page that can be published for clarity").
//
// A page is GENERATED from what the word already declares about itself — its
// description, its forms, its examples, and (when a model may say it) its
// machine grammar. Nothing is copied by hand, so a page can never drift from
// the word: change the word and the next `howto` changes the page. The same
// facts are the rule that a word cannot ship unexplained (howto.census.spec.ts
// fails for a word that declares too little to make a page).
//
// Pure: facts in, a self-contained HTML document out — inline styles, no
// script, no request — so a hive can store it as a resource and publish it as
// a website page like any other.
//
// What a page never carries: ALIASES. They are the participant's own to give,
// so a page published for the world would leak one person's shortcuts.

/** The tile every page hangs under, at the root of the hive. */
export const HOWTO_ROOT = 'how'

/** What a word declares, in the shape a page needs. Read from the slash
 *  census (`SlashBehaviourDrone.entries()`), never parsed from a description. */
export type HowToFacts = {
  readonly name: string
  readonly description: string
  readonly options: readonly string[]
  readonly examples: readonly { readonly input: string; readonly result: string }[]
  /** Typed in full: never listed in autocomplete. */
  readonly hidden: boolean
  /** Still in the workshop. */
  readonly prototype: boolean
  readonly machine?: {
    readonly forms: string
    readonly example: string
    readonly bare: boolean
    readonly reach: string
    readonly scope: string
    readonly consequence: string
  }
}

type SourceBehaviour = {
  readonly name?: unknown
  readonly description?: unknown
  readonly options?: unknown
  readonly examples?: unknown
  readonly hidden?: unknown
  readonly prototype?: unknown
  readonly machine?: unknown
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The facts of one word, read defensively: a malformed declaration yields
 *  less on the page, never a throw that stops the other pages. */
export function factsOf(source: SourceBehaviour): HowToFacts {
  const options = Array.isArray(source.options) ? source.options.map(text).filter(Boolean) : []
  const examples = (Array.isArray(source.examples) ? source.examples : [])
    .map((e: { input?: unknown; result?: unknown }) => ({ input: text(e?.input), result: text(e?.result) }))
    .filter(e => e.input)
  const m = source.machine as { forms?: unknown; example?: unknown; bare?: unknown; reach?: unknown; scope?: unknown; consequence?: unknown } | undefined
  const machine = m && text(m.example)
    ? {
      forms: text(m.forms),
      example: text(m.example),
      bare: m.bare === true,
      reach: text(m.reach) || 'editing',
      scope: text(m.scope),
      consequence: text(m.consequence),
    }
    : undefined
  return {
    name: text(source.name),
    description: text(source.description),
    options,
    examples,
    hidden: source.hidden === true,
    prototype: source.prototype === true,
    ...(machine ? { machine } : {}),
  }
}

/** What a word still has to declare before a page can explain it. Empty means
 *  the page is whole. The census spec holds every word to this. */
export function whatIsMissing(f: HowToFacts): string[] {
  const missing: string[] = []
  if (f.description.length < 20) missing.push('a description of at least a sentence')
  // A machine example is a model's terse form, not something a person can try:
  // a word with only that would explain itself to no one reading the page.
  if (f.examples.length === 0) missing.push('at least one worked example')
  return missing
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ESCAPES[c]!)

/** Self-contained look, in the family of the meetup pages. Scoped under .mp so
 *  a hive mounting the page inline never touches its shell. */
const STYLE = `<style>
  :root,.mp{
    --mp-outer:#eae7e7;--mp-bg:#f3f2f2;--mp-surface:#eae9e9;--mp-text:#201e1d;
    --mp-accent:#ec3013;--mp-strong:#ae1800;--mp-muted:#605d5d;--mp-soft:#444141;
    --mp-divider:rgba(32,30,29,.4);--mp-hover:rgba(32,30,29,.05);
    --mp-font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    --mp-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  @media (prefers-color-scheme:dark){
    :root,.mp{
      --mp-outer:#121110;--mp-bg:#1b1a19;--mp-surface:#2c2a29;--mp-text:#f1efee;
      --mp-accent:#ff5a3d;--mp-strong:#ff8a72;--mp-muted:#a8a4a3;--mp-soft:#cfcbca;
      --mp-divider:rgba(241,239,238,.28);--mp-hover:rgba(241,239,238,.06)}}
  body:has(> .mp){margin:0;background:var(--mp-outer)}
  .mp{display:block;min-height:100vh;min-height:100dvh;background:var(--mp-outer);color:var(--mp-text);
    font:400 16px/1.55 var(--mp-font);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-size-adjust:100%;text-wrap:pretty}
  .mp *,.mp *::before,.mp *::after{box-sizing:border-box;margin:0;padding:0}
  .mp a{color:var(--mp-accent);text-underline-offset:3px}
  .mp :focus-visible{outline:2px solid var(--mp-accent);outline-offset:2px}
  .mp ::selection{background:rgba(236,48,19,.3)}
  .mp .app{max-width:760px;min-height:100vh;min-height:100dvh;margin:0 auto;background:var(--mp-bg)}
  @media (min-width:762px){.mp .app{border-left:1px solid var(--mp-divider);border-right:1px solid var(--mp-divider)}}
  .mp header.top{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:12px max(16px,env(safe-area-inset-right)) 12px max(16px,env(safe-area-inset-left));
    background:var(--mp-bg);border-bottom:2px solid var(--mp-divider)}
  .mp .brand{font-weight:800;font-size:17px;letter-spacing:-.01em}
  .mp .brand em{font-style:normal;color:var(--mp-accent)}
  .mp .panel{display:block;padding:20px max(16px,env(safe-area-inset-right)) 20px max(16px,env(safe-area-inset-left));border-top:2px solid var(--mp-divider)}
  .mp .panel.lead{border-top:0}
  .mp h1{font-size:clamp(28px,7.5vw,40px);line-height:1.05;letter-spacing:-.02em;font-weight:800;margin-top:4px;overflow-wrap:anywhere}
  .mp h2{font-size:20px;line-height:1.15;font-weight:800}
  .mp .kicker{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mp-strong);font-weight:600}
  .mp .mini{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mp-muted)}
  .mp .sub{font-size:14px;color:var(--mp-soft);margin-top:8px}
  .mp .panel p{margin-top:10px;font-size:15px;color:var(--mp-soft)}
  .mp .panel p.sub{font-size:14px}
  .mp code{font:600 .86em/1.4 var(--mp-mono);background:var(--mp-surface);color:var(--mp-text);padding:1px 5px;
    overflow-wrap:anywhere;-webkit-box-decoration-break:clone;box-decoration-break:clone}
  .mp .stage{display:inline-block;margin-top:10px;font-size:12px;font-weight:700;border:1px solid var(--mp-divider);padding:2px 8px;color:var(--mp-strong)}
  .mp .steps{list-style:none;border-top:2px solid var(--mp-divider);margin-top:12px}
  .mp .steps li{display:grid;grid-template-columns:2em minmax(0,1fr);gap:0 10px;padding:12px 4px;border-bottom:1px solid var(--mp-divider);
    font-size:15px;line-height:1.5;color:var(--mp-soft)}
  .mp .steps .num{font-weight:800;font-size:13px;color:var(--mp-text);font-variant-numeric:tabular-nums;padding-top:2px}
  .mp .steps .result{display:block;margin-top:4px}
  .mp .forms{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .mp .words{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);border-top:2px solid var(--mp-divider);margin-top:6px}
  .mp .words dt,.mp .words dd{padding:9px 0;border-bottom:1px solid var(--mp-divider)}
  .mp .words dt{padding-right:12px;font-size:15px;line-height:1.5}
  .mp .words dd{padding-left:12px;border-left:1px solid var(--mp-divider);font-size:14px;line-height:1.45;color:var(--mp-soft)}
  .mp [id]{scroll-margin-top:64px}
  .mp .letters{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .mp .letters a{display:inline-block;min-width:32px;min-height:32px;padding:4px 8px;border:1px solid var(--mp-divider);text-align:center;text-decoration:none;color:var(--mp-text);font-weight:700}
  .mp .letters a:hover{border-color:var(--mp-accent);background:var(--mp-hover)}
  .mp .group{margin-top:16px}
  .mp .links{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px}
  .mp .links a{display:grid;gap:2px;min-height:44px;padding:12px 14px;border:1px solid var(--mp-divider);color:var(--mp-text);text-decoration:none}
  .mp .links a:hover{border-color:var(--mp-accent);background:var(--mp-hover)}
  .mp .links b{font-size:15px;font-weight:700;line-height:1.3}
  .mp .links b::after{content:" \\2192";color:var(--mp-accent)}
</style>`

const head = (title: string, description: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description.slice(0, 200))}">
${STYLE}
</head>
<body>
<div class="mp">
<div class="app">
`

const FOOT = `
</div>
</div>
</body>
</html>
`

/** Where a word's page sits relative to the index: the tile is the word. */
export const pageHref = (name: string): string => `${encodeURIComponent(name)}/`

const num = (i: number): string => String(i + 1).padStart(2, '0')

/** One word's page. */
export function wordPageHtml(f: HowToFacts): string {
  const sayIt = f.examples.length
    ? `<section class="panel" aria-labelledby="say">
      <h2 id="say">Say it</h2>
      <ol class="steps">
${f.examples.map((e, i) => `        <li><span class="num">${num(i)}</span><span><code>${esc(e.input)}</code>${e.result ? `<span class="result">${esc(e.result)}</span>` : ''}</span></li>`).join('\n')}
      </ol>
    </section>`
    : ''
  const forms = f.options.length
    ? `<section class="panel" aria-labelledby="forms">
      <h2 id="forms">Forms</h2>
      <ul class="forms">
${f.options.map(o => `        <li><code>${esc(`${f.name} ${o}`.trim())}</code></li>`).join('\n')}
      </ul>
    </section>`
    : ''
  const model = f.machine
    ? `<section class="panel" aria-labelledby="model">
      <h2 id="model">When a model says it</h2>
      <p>A model that speaks only the communication layer may say this word. It changes things at the level of <code>${esc(f.machine.reach)}</code>${f.machine.scope ? `, as far as <code>${esc(f.machine.scope)}</code>` : ''}.</p>
      <dl class="words">
${f.machine.forms ? `        <dt>Forms</dt><dd><code>${esc(f.machine.forms)}</code></dd>\n` : ''}        <dt>Example</dt><dd><code>${esc(f.machine.example)}</code></dd>
${f.machine.bare ? '        <dt>On its own</dt><dd>Said bare, it is a complete call.</dd>\n' : ''}${f.machine.consequence ? `        <dt>What it costs</dt><dd>${esc(f.machine.consequence)}</dd>\n` : ''}      </dl>
    </section>`
    : ''
  const stage = f.prototype
    ? '<p class="stage">In the workshop: still being played with</p>'
    : f.hidden
      ? '<p class="stage">Typed in full: never offered by autocomplete</p>'
      : ''
  return head(`${f.name} · How to`, f.description || `How to say ${f.name}.`)
    + `  <header class="top">
    <span class="brand">Hypercomb <em>Words</em></span>
    <a class="mini" href="../">All words</a>
  </header>

  <main>
    <section class="panel lead" aria-label="${esc(f.name)}">
      <header>
        <span class="kicker">How to say it</span>
        <h1>${esc(f.name)}</h1>
      </header>
      <p class="sub">${esc(f.description)}</p>
      ${stage}
    </section>
${[sayIt, forms, model].filter(Boolean).map(s => `\n    ${s}\n`).join('')}  </main>

  <footer class="panel">
    <ul class="links">
      <li><a href="../"><b>All words</b><span>Every word the hive understands</span></a></li>
    </ul>
  </footer>
` + FOOT
}

/** The index: every word, A to Z, each a link to its page. */
export function indexPageHtml(all: readonly HowToFacts[]): string {
  const words = [...all].filter(f => f.name).sort((a, b) => a.name.localeCompare(b.name))
  const letters = [...new Set(words.map(f => f.name[0]!.toUpperCase()))]
  const group = (letter: string): string => `    <section class="panel" aria-labelledby="l-${esc(letter)}">
      <h2 id="l-${esc(letter)}">${esc(letter)}</h2>
      <dl class="words">
${words.filter(f => f.name[0]!.toUpperCase() === letter).map(f => `        <dt><a href="${pageHref(f.name)}"><code>${esc(f.name)}</code></a></dt><dd>${esc(f.description)}</dd>`).join('\n')}
      </dl>
    </section>`
  return head('How to say it · Every word', `Every word the hive understands: what it does and how to say it. ${words.length} words.`)
    + `  <header class="top">
    <span class="brand">Hypercomb <em>Words</em></span>
    <span class="mini">${words.length} words</span>
  </header>

  <main>
    <section class="panel lead" aria-label="Every word">
      <header>
        <span class="kicker">The language</span>
        <h1>How to say it</h1>
      </header>
      <p class="sub">Every word the hive understands, what it does, and a way to say it. Pick a word for its page.</p>
      <ul class="letters">
${letters.map(l => `        <li><a href="#l-${esc(l)}">${esc(l)}</a></li>`).join('\n')}
      </ul>
    </section>

${letters.map(group).join('\n\n')}
  </main>
` + FOOT
}
