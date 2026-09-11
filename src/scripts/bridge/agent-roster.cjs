// agent-roster.cjs — WHICH FRONTIER BRIDGES THIS MACHINE ACTUALLY HAS.
//
// The roster itself is data (`agent-bridges.json`); this module is the three
// questions everything else asks of it:
//
//   installed()        which of them are on PATH right now
//   agentForModel(h)   which bridge answers a model hint ("opus", "gemini")
//   invocation(a, m)   the exact { bin, args } to spawn for one ask
//
// Shared by `bridge-agents.cjs` (probe + announce) and `drain-tick.cjs` (the
// unattended drain), so the answer to "who can answer this?" is computed in
// ONE place. Nothing here spawns a model; probing is a `--version` call with
// a hard timeout, which is free.
//
// WINDOWS: npm installs CLIs as `.cmd` shims, which modern Node REFUSES to
// spawn without a shell (EINVAL) while `shell: true` would mangle the prompt.
// `spawnPlan` below solves both at once, and every caller uses it — including
// the probe, which is how a shim left behind by an uninstall is caught before
// the hive is told a bridge exists.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROSTER_PATH = path.join(__dirname, 'agent-bridges.json')

/** Every declared bridge, installed or not. */
function declared() {
  try {
    const raw = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'))
    return Array.isArray(raw.agents) ? raw.agents : []
  } catch (err) {
    console.error(`[agent-roster] cannot read ${ROSTER_PATH}: ${err.message}`)
    return []
  }
}

const WIN_EXTS = ['.cmd', '.exe', '.bat', '.ps1', '']

/**
 * WINDOWS BATCH SHIMS CANNOT BE SPAWNED DIRECTLY. Since the CVE-2024-27980
 * fix, Node refuses `spawn('x.cmd', args)` with EINVAL unless `shell: true` —
 * and `shell: true` concatenates argv without escaping (DEP0190), which
 * mangles any prompt containing a quote or an ampersand. A drain prompt is
 * several sentences of English, so that is not hypothetical.
 *
 * The way out is to be the shell ourselves: invoke ComSpec with `/d /s /c`
 * and ONE pre-quoted command line, with `windowsVerbatimArguments` so Node
 * passes it through untouched. Quoting follows the CommandLineToArgvW rules
 * (double the backslashes that precede a quote, escape the quote), plus `^`
 * for cmd.exe's own metacharacters outside quotes — which is exactly what
 * `shell: true` fails to do.
 *
 * Everything else (a real .exe, anything on POSIX) is spawned directly.
 */
const needsComSpec = (bin) =>
  process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(bin))

const quoteForCmd = (value) => {
  const text = String(value)
  if (text !== '' && !/[\s"^&|<>()%!]/.test(text)) return text
  // Backslash runs before a quote (and at the end) must be doubled.
  const escaped = text
    .replace(/(\\*)"/g, (_, slashes) => `${slashes}${slashes}\\"`)
    .replace(/(\\*)$/, (_, slashes) => `${slashes}${slashes}`)
  return `"${escaped}"`
}

/**
 * An npm `.cmd` shim does nothing but forward to a real program — a native
 * binary (`"%dp0%\node_modules\...\bin\claude.exe" %*`) or node with a script.
 * Spawning that program directly takes cmd.exe out of the path, and with it the
 * three things its command line cannot do: carry a line break (a line break
 * ENDS the line and every argument after it is dropped), keep `%NAME%`
 * unexpanded, and keep a `"` inside an argument from flipping its quote state so
 * that `>`, `|` or `&` later in the argument are read as shell syntax. Null when
 * the shim is not that shape.
 */
function unwrapNpmShim(shim) {
  let text
  try { text = fs.readFileSync(shim, 'utf8') } catch { return null }
  const target = /"%dp0%\\([^"%]+)"\s+%\*/i.exec(text)
  if (!target) return null
  const dir = path.dirname(shim)
  const file = path.join(dir, target[1])
  if (!fs.existsSync(file)) return null
  if (/\.exe$/i.test(file)) return { file, prefix: [] }
  if (/\.[cm]?js$/i.test(file)) {
    const localNode = path.join(dir, 'node.exe')
    return { file: fs.existsSync(localNode) ? localNode : process.execPath, prefix: [file] }
  }
  return null
}

/** `{ file, args, options, viaComSpec }` ready for spawn/spawnSync on this
 *  platform. `viaComSpec` is true only for a batch file that could not be
 *  unwrapped — the one case whose arguments pass through cmd.exe's parser. */
function spawnPlan(bin, args) {
  if (!needsComSpec(bin)) return { file: bin, args, options: {}, viaComSpec: false }
  const direct = unwrapNpmShim(bin)
  if (direct) return { file: direct.file, args: [...direct.prefix, ...args], options: {}, viaComSpec: false }
  const line = [bin, ...args].map(quoteForCmd).join(' ')
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', line],
    options: { windowsVerbatimArguments: true },
    viaComSpec: true,
  }
}

/** Absolute path to `bin` on PATH, or '' — the Windows shim dance included. */
function resolveBin(bin) {
  const name = String(bin || '').trim()
  if (!name) return ''
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const exts = process.platform === 'win32' ? WIN_EXTS : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch { /* not here */ }
    }
  }
  return ''
}

/**
 * Is this bridge usable? Present on PATH AND answering `--version` — a shim
 * left behind by an uninstall resolves but cannot run, and announcing it
 * would offer the hive a bridge that fails at drain time.
 */
function probe(agent) {
  const bin = resolveBin(agent.bin)
  if (!bin) return { ...agent, installed: false, bin: '', version: '' }
  let version = ''
  try {
    const plan = spawnPlan(bin, agent.versionArgs ?? ['--version'])
    const out = spawnSync(plan.file, plan.args, {
      encoding: 'utf8', timeout: 20_000, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], ...plan.options,
    })
    if (out.error || out.status !== 0) return { ...agent, installed: false, bin, version: '' }
    version = String(out.stdout || out.stderr || '').trim().split('\n')[0].slice(0, 80)
  } catch {
    return { ...agent, installed: false, bin, version: '' }
  }
  return { ...agent, installed: true, bin, version }
}

/** Probe every declared bridge. */
function probeAll() {
  return declared().map(probe)
}

/** Only the ones that answered. */
function installed() {
  return probeAll().filter(a => a.installed)
}

/**
 * The bridge that owns a model hint. Exact model name first, then wire id,
 * then the agent's own id — so `/opus`, `claude-opus-5`, and `claude-bridge`
 * all resolve. Returns undefined rather than guessing across vendors.
 */
function agentForModel(hint, agents = declared()) {
  const wanted = String(hint || '').trim().toLowerCase()
  if (!wanted) return undefined
  return agents.find(a => (a.models ?? []).some(m => String(m.name).toLowerCase() === wanted))
    ?? agents.find(a => (a.models ?? []).some(m => String(m.id).toLowerCase() === wanted))
    ?? agents.find(a => String(a.id).toLowerCase() === wanted)
}

/** The wire model id for a hint within one agent, else the agent's default. */
function modelIdFor(agent, hint) {
  const wanted = String(hint || '').trim().toLowerCase()
  const models = agent.models ?? []
  const hit = models.find(m => String(m.name).toLowerCase() === wanted)
    ?? models.find(m => String(m.id).toLowerCase() === wanted)
  return hit?.id ?? agent.defaultModel ?? models[0]?.id ?? ''
}

/**
 * The spawn plan for one ask: `{ file, args, options }`, ready to hand
 * straight to `spawn` — the ComSpec wrapper is already applied where the
 * platform needs it, so a caller never branches on Windows.
 *
 * `{prompt}` and `{model}` are substituted inside argv elements. An element
 * that is ONLY an unresolved placeholder is DROPPED along with a preceding
 * lone flag — so a CLI with no model switch (or a roster entry that omits
 * `models`) still produces a runnable command instead of passing the literal
 * string "{model}" to a vendor.
 */
//
// READ-ONLY WORK. `{ readOnly: true }` spawns from the bridge's `readOnlyArgv`
// instead: a template that must remove every tool that writes AND stop the
// machine's own settings from granting one back. `{allow}` in it expands to
// the caller's `allow` rules, one argument each; with no rules it is dropped
// with its flag, which allows nothing rather than everything. A bridge that
// declares no read-only template is REFUSED — `bin` is '' and `refused` says
// why — because the only safe way to run "without write access" on a bridge
// that cannot promise it is not to run.
function invocation(agent, prompt, modelHint, opts = {}) {
  const readOnly = opts.readOnly === true
  if (readOnly && !Array.isArray(agent.readOnlyArgv)) {
    return { bin: '', args: [], model: '', file: '', spawnArgs: [], options: {}, refused: `${agent.id} declares no read-only invocation` }
  }
  const bin = agent.bin && path.isAbsolute(agent.bin) ? agent.bin : resolveBin(agent.bin)
  const model = modelIdFor(agent, modelHint)
  const template = (readOnly ? agent.readOnlyArgv : agent.argv) ?? []
  const allow = Array.isArray(opts.allow) ? opts.allow.map(String).filter(Boolean) : []
  const args = []
  for (let i = 0; i < template.length; i++) {
    const raw = String(template[i])
    if ((raw === '{model}' && !model) || (raw === '{allow}' && !allow.length)) {
      // drop the flag that introduced it, if we just pushed one
      if (args.length && /^-/.test(args[args.length - 1])) args.pop()
      continue
    }
    if (raw === '{allow}') { args.push(...allow); continue }
    // Replacer functions, so a `$&` or `$1` in a prompt stays literal.
    args.push(raw.replace('{prompt}', () => prompt).replace('{model}', () => model))
  }
  const plan = spawnPlan(bin, args)
  // Only a batch file that could not be unwrapped still goes through cmd.exe
  // (see unwrapNpmShim). Its command line cannot carry a line break — a line
  // break ENDS it, so every argument after it, lock flags included, silently
  // never arrives (measured: `-p "a<LF>b" --restricted` reached the CLI as just
  // `-p a`) — expands `%NAME%` even inside quotes, and a `"` inside an argument
  // flips its quote state so the rest is read as shell syntax (measured: a
  // prompt quoting `cmd /c "echo x > …"` never reached the program at all).
  // Refuse, rather than spawn something other than what was built.
  if (plan.viaComSpec && args.some(arg => /[\r\n%"]/.test(arg))) {
    return {
      bin: '', args, model, file: '', spawnArgs: [], options: {},
      refused: `${agent.id}: an argument carries a line break, % or " that cmd.exe cannot pass to ${path.basename(bin)} intact`,
    }
  }
  return { bin, args, model, file: plan.file, spawnArgs: plan.args, options: plan.options, refused: '' }
}

/**
 * A bridge as an `llm-provider@1` spec — what gets announced to the hive so
 * the providers console lists it beside the HTTP vendors.
 *
 * `transport: 'agent-bridge'` and `readsHive: true` are the honest part: this
 * tier is the only one that can walk the participant's tree, and it needs no
 * API key because the CLI carries its own account.
 */
function toProviderSpec(agent) {
  return {
    format: 'llm-provider@1',
    id: agent.id,
    label: agent.label,
    vendor: agent.vendor,
    transport: 'agent-bridge',
    shape: 'agent-bridge',
    models: (agent.models ?? []).map(m => ({ name: m.name, id: m.id, tier: m.tier })),
    defaultModel: agent.defaultModel ?? (agent.models ?? [])[0]?.id ?? '',
    docsUrl: agent.docsUrl ?? '',
    requiresKey: false,
    readsHive: true,
  }
}

module.exports = {
  ROSTER_PATH,
  declared,
  probe,
  probeAll,
  installed,
  resolveBin,
  spawnPlan,
  agentForModel,
  modelIdFor,
  invocation,
  toProviderSpec,
}
