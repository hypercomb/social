const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { definitions, mayReadAsText } = require('./heuristics.cjs')
const { strategies, compositions, scoutTargets } = require('./strategy.cjs')
const { canonical, sign, algorithmArtifact, algorithmSignature, heuristicKey, answerArtifact } = require('./protocol.cjs')

const DEFAULT_IGNORES = new Set(['.git', '.hypercomb', '.worktrees', 'node_modules', 'dist', 'coverage', 'test-results'])
const WATCH_IGNORED_PREFIXES = ['hypercomb-relay/content/']
const MAX_FILE_BYTES = 4 * 1024 * 1024
const HISTORY_LIMIT = 256
const HISTORY_CHECKPOINT_MS = 60 * 1000
const PACK_THRESHOLD_BYTES = 1024
const PACK_TARGET_BYTES = 1024 * 1024
const PACK_CATALOG_RECORD_BYTES = 72
const EXPORT_PROTOCOL = 'hypercomb-heuristic-export/v4'
const execFileAsync = promisify(execFile)

const cloneStats = stats => ({ ...stats })
const statsDelta = (current, previous) => Object.fromEntries(Object.keys(current).map(key => [key, current[key] - (previous[key] || 0)]))
const resultCounts = index => {
  const counts = {}
  for (const result of Object.values(index.results)) counts[result.heuristic] = (counts[result.heuristic] || 0) + 1
  return counts
}
const countDelta = (current, previous) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value - (previous[key] || 0)]).filter(([, value]) => value > 0))

class HeuristicService {
  constructor(root, options = {}) {
    this.root = path.resolve(root)
    this.store = path.resolve(options.store || path.join(this.root, '.hypercomb', 'heuristics'))
    this.maxFileBytes = options.maxFileBytes || MAX_FILE_BYTES
    this.definitions = options.definitions || definitions
    this.managePaths = options.managePaths !== false
    this.historyLimit = options.historyLimit || HISTORY_LIMIT
    this.historyCheckpointMs = options.historyCheckpointMs || HISTORY_CHECKPOINT_MS
    this.algorithms = this.definitions.map(definition => ({ definition, sig: algorithmSignature(definition) }))
    this.auditSig = sign(Buffer.from(canonical(this.algorithms.map(({ definition, sig }) => ({ id: definition.id, sig })))))
    this.index = { protocol: 'hypercomb-heuristic-index/v1', paths: {}, results: {}, algorithms: {} }
    this.stats = { filesSeen: 0, filesScanned: 0, filesSkipped: 0, heuristicRuns: 0, findings: 0, noResult: 0, cacheHits: 0, unsupportedFiles: 0 }
    this.strategy = {
      protocol: 'hypercomb-heuristic-strategy/v1',
      admission: 'Publish any exact reusable result when verified lookup is cheaper than recomputation; identical answer signatures reuse the existing bytes.',
      strategies,
      compositions,
      scoutTargets,
    }
    this.strategyBytes = Buffer.from(canonical(this.strategy))
    this.strategySig = sign(this.strategyBytes)
  }

  async open() {
    await fsp.mkdir(path.join(this.store, 'resources'), { recursive: true })
    await fsp.writeFile(path.join(this.store, 'resources', this.strategySig), this.strategyBytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    try { this.index = JSON.parse(await fsp.readFile(path.join(this.store, 'index.json'), 'utf8')) } catch {}
    this.index.paths ||= {}
    this.index.results ||= {}
    this.index.algorithms ||= {}
    const registryWasCurrent = this.algorithms.every(({ definition, sig }) => this.index.algorithms[definition.id]?.algorithmSig === sig)
    for (const { definition, sig } of this.algorithms) {
      this.index.algorithms[definition.id] = { algorithmSig: sig, version: definition.version }
      await fsp.writeFile(path.join(this.store, 'resources', sig), algorithmArtifact(definition), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    }
    // Upgrade indexes created before the explicit cursor existed without a
    // full rescan when their algorithm signatures already prove that the same
    // audit ran. This changes scheduling metadata only.
    if (this.managePaths && registryWasCurrent) {
      for (const state of Object.values(this.index.paths)) state.auditedWith = this.auditSig
    }
    return this
  }

  async files(directory = this.root) {
    // Git's view is the correct repository boundary: tracked files plus
    // non-ignored working-tree additions. A raw walk pulls generated content
    // and caches into the miner, making the optimization itself expensive.
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', this.root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
      ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      return stdout.toString('utf8').split('\0').filter(Boolean).map(relative => path.join(this.root, relative))
    } catch {
      // Non-Git directories remain supported for tests and future
      // participant-selected sources.
    }
    const found = []
    const walk = async current => {
      let entries
      try { entries = await fsp.readdir(current, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && DEFAULT_IGNORES.has(entry.name)) continue
        const absolute = path.join(current, entry.name)
        if (entry.isDirectory()) await walk(absolute)
        else if (entry.isFile()) found.push(absolute)
      }
    }
    await walk(directory)
    return found
  }

  relative(absolute) { return path.relative(this.root, absolute).replaceAll('\\', '/') }

  async auditFile(absolute) {
    this.stats.filesSeen++
    const relative = this.relative(absolute)
    if (relative.startsWith('../') || path.isAbsolute(relative)) return
    let stat
    try { stat = await fsp.stat(absolute) } catch { return }
    if (!stat.isFile() || stat.size > this.maxFileBytes) { this.stats.unsupportedFiles++; return }
    const fingerprint = `${stat.size}:${stat.mtimeMs}`
    const previous = this.index.paths[relative]
    const pathSig = sign(Buffer.from(relative))
    // This is a local scheduling cursor, not a negative result. It prevents an
    // idle heartbeat from rerunning every no-finding heuristic over unchanged
    // bytes. Any content or algorithm-list change invalidates it naturally.
    const allCurrent = previous && previous.fingerprint === fingerprint && previous.auditedWith === this.auditSig
    if (allCurrent) { this.stats.filesSkipped++; return }

    const bytes = await fsp.readFile(absolute)
    const contentSig = sign(bytes)
    const text = mayReadAsText(relative, bytes) ? bytes.toString('utf8') : null
    const file = { path: relative, bytes, text, contentSig }
    for (const { definition, sig: algorithmSig } of this.algorithms) {
      const params = definition.usesPath ? [contentSig, pathSig] : [contentSig]
      const key = heuristicKey(algorithmSig, params)
      if (this.index.results[key]) {
        Object.assign(this.index.results[key], { algorithmSig, params })
        this.stats.cacheHits++
        continue
      }
      let outcome
      try { outcome = definition.run(file) } catch (error) { outcome = { status: 'error', value: { message: String(error?.message || error) } } }
      this.stats.heuristicRuns++
      // A heuristic publishes only a finding. False, unsupported, and failed
      // attempts leave no key or result artifact behind. If absence itself is
      // useful, it is authored as a separate positive heuristic.
      if (outcome.status === 'unsupported' || outcome.status === 'error' || !outcome.matched) {
        this.stats.noResult++
        continue
      }
      const answerBytes = answerArtifact(outcome.value)
      const answerSig = sign(answerBytes)
      await fsp.writeFile(path.join(this.store, 'resources', answerSig), answerBytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
      this.index.results[key] = { answerSig, heuristic: definition.id, algorithmSig, params }
      this.stats.findings++
    }

    this.index.paths[relative] = { contentSig, fingerprint, auditedWith: this.auditSig }
    this.stats.filesScanned++
  }

  async audit() {
    const statsBefore = cloneStats(this.stats)
    const resultsBefore = resultCounts(this.index)
    const files = await this.files()
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const index = cursor++
        if (index >= files.length) return
        await this.auditFile(files[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker))
    await this.save()
    const delta = statsDelta(this.stats, statsBefore)
    if (delta.filesScanned || delta.heuristicRuns || delta.findings || delta.cacheHits) {
      await this.recordHistory('audit', { delta, discoveries: countDelta(resultCounts(this.index), resultsBefore) })
    }
    return this.stats
  }

  async history(limit = this.historyLimit) {
    try {
      const text = await fsp.readFile(path.join(this.store, 'history.jsonl'), 'utf8')
      const lines = text.trim().split('\n').filter(Boolean)
      return lines.slice(-Math.max(0, Number(limit) || 0)).map(line => JSON.parse(line))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  async recordHistory(kind, details = {}) {
    const target = path.join(this.store, 'history.jsonl')
    const lockPath = `${target}.lock`
    let lock
    for (let attempt = 0; attempt < 200; attempt++) {
      try { lock = await fsp.open(lockPath, 'wx'); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    if (!lock) throw new Error('heuristic history remained locked')
    try {
      const prior = await this.history(this.historyLimit)
      const body = {
        protocol: 'hypercomb-heuristic-history/v1',
        at: new Date().toISOString(),
        kind,
        auditSig: this.auditSig,
        strategySig: this.strategySig,
        previousSig: prior.at(-1)?.entrySig || null,
        indexSig: sign(Buffer.from(canonical({ algorithms: this.index.algorithms, paths: this.index.paths, results: this.index.results }))),
        counts: {
          algorithms: Object.keys(this.index.algorithms).length,
          trackedDocuments: Object.keys(this.index.paths).length,
          results: Object.keys(this.index.results).length,
        },
        ...details,
      }
      const entry = { ...body, entrySig: sign(Buffer.from(canonical(body))) }
      const kept = [...prior, entry].slice(-this.historyLimit)
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      await fsp.writeFile(temporary, kept.map(item => canonical(item)).join('\n') + '\n')
      await fsp.rename(temporary, target)
      return entry
    } finally {
      await lock.close()
      await fsp.unlink(lockPath).catch(() => {})
    }
  }

  async save() {
    const target = path.join(this.store, 'index.json')
    const lockPath = `${target}.lock`
    let lock
    for (let attempt = 0; attempt < 200; attempt++) {
      try { lock = await fsp.open(lockPath, 'wx'); break }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    if (!lock) throw new Error('heuristic index remained locked')
    try {
      let disk = { protocol: this.index.protocol, paths: {}, results: {}, algorithms: {} }
      try { disk = JSON.parse(await fsp.readFile(target, 'utf8')) } catch {}
      const merged = {
        protocol: this.index.protocol,
        paths: { ...(disk.paths || {}), ...(this.index.paths || {}) },
        results: { ...(disk.results || {}), ...(this.index.results || {}) },
        algorithms: { ...(disk.algorithms || {}), ...(this.index.algorithms || {}) },
      }
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      await fsp.writeFile(temporary, JSON.stringify(merged, null, 2) + '\n')
      await fsp.rename(temporary, target)
      this.index = merged
    } finally {
      await lock.close()
      await fsp.unlink(lockPath).catch(() => {})
    }
  }

  async aggregate(heuristicId, options = {}) {
    const records = []
    for (const [file, state] of Object.entries(this.index.paths)) {
      const algorithm = this.index.algorithms[heuristicId]
      if (!algorithm) throw new Error(`unknown heuristic: ${heuristicId}`)
      const definition = this.algorithms.find(item => item.definition.id === heuristicId)?.definition
      const params = definition?.usesPath ? [state.contentSig, sign(Buffer.from(file))] : [state.contentSig]
      const key = heuristicKey(algorithm.algorithmSig, params)
      const pointer = this.index.results[key]
      if (!pointer) continue
      const bytes = await fsp.readFile(path.join(this.store, 'resources', pointer.answerSig))
      let value
      try { value = JSON.parse(bytes.toString('utf8')) } catch { value = bytes.toString('utf8') }
      records.push({ file, contentSig: state.contentSig, answerSig: pointer.answerSig, value })
    }
    return records
  }

  async summary() {
    const summary = {}
    for (const [key, pointer] of Object.entries(this.index.results)) {
      const row = summary[pointer.heuristic] ||= { findings: 0 }
      row.findings++
    }
    await this.save()
    return summary
  }

  async compute(algorithmSig, params, execute) {
    const computationSig = heuristicKey(algorithmSig, params)
    const saved = this.index.results[computationSig]
    if (saved) {
      Object.assign(saved, { algorithmSig, params: [...params] })
      await this.save()
      const bytes = await fsp.readFile(path.join(this.store, 'resources', saved.answerSig))
      if (sign(bytes) !== saved.answerSig) throw new Error(`answer resource failed verification: ${saved.answerSig}`)
      return { computationSig, answerSig: saved.answerSig, bytes, source: 'saved' }
    }
    if (typeof execute !== 'function') return { computationSig, answerSig: null, bytes: null, source: 'none' }
    const answer = await execute()
    if (answer == null) return { computationSig, answerSig: null, bytes: null, source: 'none' }
    const bytes = answerArtifact(answer)
    const answerSig = sign(bytes)
    await fsp.writeFile(path.join(this.store, 'resources', answerSig), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    this.index.results[computationSig] = { answerSig, heuristic: this.algorithms.find(item => item.sig === algorithmSig)?.definition.id || 'external', algorithmSig, params: [...params] }
    await this.save()
    return { computationSig, answerSig, bytes, source: 'computed' }
  }

  async exportDump(output) {
    const destination = path.resolve(output)
    await fsp.mkdir(destination, { recursive: true })
    const heapPoolSig = sign(Buffer.from('heuristics:heap'))
    const heap = path.join(destination, heapPoolSig)
    await fsp.mkdir(heap, { recursive: true })
    const semanticSig = sign(Buffer.from(canonical({ algorithms: this.index.algorithms, results: this.index.results })))
    const statePath = path.join(this.store, 'export-state.json')
    try {
      const state = JSON.parse(await fsp.readFile(statePath, 'utf8'))
      if (state.semanticSig === semanticSig && state.destination === destination && state.receipt?.protocol === EXPORT_PROTOCOL) return { ...state.receipt, skipped: true }
    } catch {}
    const writeArtifact = async (sig, bytes) => {
      if (sign(bytes) !== sig) throw new Error(`artifact signature mismatch: ${sig}`)
      const target = path.join(heap, sig)
      try {
        const existing = await fsp.readFile(target)
        if (!existing.equals(bytes)) throw new Error(`conflicting artifact already exists: ${target}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await fsp.writeFile(target, bytes, { flag: 'wx' })
      }
    }
    const writePointer = async (meaning, key, sig, replace = false) => {
      const pool = path.join(destination, sign(Buffer.from(meaning)))
      await fsp.mkdir(pool, { recursive: true })
      const target = path.join(pool, key)
      const bytes = Buffer.from(sig)
      try {
        const existing = await fsp.readFile(target)
        if (!existing.equals(bytes)) {
          if (!replace) throw new Error(`conflicting pool pointer already exists: ${target}`)
          await fsp.writeFile(target, bytes)
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await fsp.writeFile(target, bytes, { flag: 'wx' })
      }
    }

    for (const { definition, sig } of this.algorithms) await writeArtifact(sig, algorithmArtifact(definition))
    const currentSigs = new Set(this.algorithms.map(item => item.sig))
    for (const { algorithmSig } of Object.values(this.index.algorithms)) {
      if (currentSigs.has(algorithmSig)) continue
      try { await writeArtifact(algorithmSig, await fsp.readFile(path.join(this.store, 'resources', algorithmSig))) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    // Backfill operand metadata for repository answers minted before vectors
    // existed. No answer is recomputed; keys prove each relationship.
    for (const [file, state] of Object.entries(this.index.paths)) {
      for (const { definition, sig: algorithmSig } of this.algorithms) {
        const params = definition.usesPath ? [state.contentSig, sign(Buffer.from(file))] : [state.contentSig]
        const computationSig = heuristicKey(algorithmSig, params)
        const pointer = this.index.results[computationSig]
        if (pointer) Object.assign(pointer, { algorithmSig, params })
      }
    }

    let packState = { protocol: 'hypercomb-heuristic-pack-state/v1', destination, locations: {} }
    const packStatePath = path.join(this.store, 'pack-state.json')
    try {
      const saved = JSON.parse(await fsp.readFile(packStatePath, 'utf8'))
      if (saved.destination === destination) packState = saved
    } catch {}
    const referencedPacks = [...new Set(Object.values(packState.locations).map(location => location.packSig))]
    for (const packSig of referencedPacks) {
      try { await fsp.access(path.join(heap, packSig)) }
      catch { packState = { protocol: 'hypercomb-heuristic-pack-state/v1', destination, locations: {} }; break }
    }

    let results = 0
    const pendingSmallAnswers = new Map()
    for (const [key, pointer] of Object.entries(this.index.results)) {
      const bytes = await fsp.readFile(path.join(this.store, 'resources', pointer.answerSig))
      if (sign(bytes) !== pointer.answerSig) throw new Error(`answer resource failed verification: ${pointer.answerSig}`)
      if (bytes.length <= PACK_THRESHOLD_BYTES) {
        if (!packState.locations[pointer.answerSig]) pendingSmallAnswers.set(pointer.answerSig, bytes)
      } else {
        await writeArtifact(pointer.answerSig, bytes)
      }
      await writePointer('heuristics:results', key, pointer.answerSig)
      results++
    }

    let packParts = []
    let packBytes = 0
    const flushPack = async () => {
      if (!packParts.length) return
      const bytes = Buffer.concat(packParts.map(part => part.bytes))
      const packSig = sign(bytes)
      await writeArtifact(packSig, bytes)
      let offset = 0
      for (const part of packParts) {
        packState.locations[part.answerSig] = { packSig, offset, length: part.bytes.length }
        offset += part.bytes.length
      }
      packParts = []
      packBytes = 0
    }
    for (const [answerSig, bytes] of [...pendingSmallAnswers].sort(([a], [b]) => a.localeCompare(b))) {
      if (packBytes && packBytes + bytes.length > PACK_TARGET_BYTES) await flushPack()
      packParts.push({ answerSig, bytes })
      packBytes += bytes.length
    }
    await flushPack()

    // Published pack catalogs are fixed-width binary records with no repeated
    // field names or delimiters:
    // answerSig[32] | packSig[32] | offset uint32be | length uint32be.
    // Records sort by answerSig, so readers can binary-search them directly.
    const packLocations = Object.entries(packState.locations).sort(([a], [b]) => a.localeCompare(b))
    const packCatalogBytes = Buffer.alloc(packLocations.length * PACK_CATALOG_RECORD_BYTES)
    packLocations.forEach(([answerSig, location], index) => {
      const cursor = index * PACK_CATALOG_RECORD_BYTES
      Buffer.from(answerSig, 'hex').copy(packCatalogBytes, cursor)
      Buffer.from(location.packSig, 'hex').copy(packCatalogBytes, cursor + 32)
      packCatalogBytes.writeUInt32BE(location.offset, cursor + 64)
      packCatalogBytes.writeUInt32BE(location.length, cursor + 68)
    })
    const packCatalogSig = sign(packCatalogBytes)
    await writeArtifact(packCatalogSig, packCatalogBytes)
    await writePointer('heuristics:packs', 'current', packCatalogSig, true)

    const vectors = new Map()
    for (const [computationSig, pointer] of Object.entries(this.index.results)) {
      if (!pointer.algorithmSig || !Array.isArray(pointer.params)) continue
      pointer.params.forEach((operandSig, position) => {
        const facts = vectors.get(operandSig) || []
        facts.push({ position, algorithmSig: pointer.algorithmSig, computationSig, answerSig: pointer.answerSig })
        vectors.set(operandSig, facts)
      })
    }
    for (const [operandSig, facts] of vectors) {
      facts.sort((a, b) => a.computationSig.localeCompare(b.computationSig) || a.position - b.position)
      const vectorBytes = Buffer.from(canonical({ protocol: 'hypercomb-heuristic-vector/v1', operandSig, facts }))
      const vectorSig = sign(vectorBytes)
      await writeArtifact(vectorSig, vectorBytes)
      await writePointer('heuristics:vectors', operandSig, vectorSig, true)
    }

    const list = {
      protocol: 'hypercomb-heuristic-list/v1',
      algorithms: Object.entries(this.index.algorithms).map(([id, record]) => ({ id, version: record.version, algorithmSig: record.algorithmSig })).sort((a, b) => a.id.localeCompare(b.id)),
    }
    const listBytes = Buffer.from(canonical(list))
    const listSig = sign(listBytes)
    await writeArtifact(listSig, listBytes)
    await writePointer('heuristics:lists', 'repository-default', listSig, true)

    const packCount = new Set(Object.values(packState.locations).map(location => location.packSig)).size
    const manifest = { protocol: EXPORT_PROTOCOL, heapPoolSig, listSig, packCatalogSig, packCatalogRecordBytes: PACK_CATALOG_RECORD_BYTES, packCount, packedAnswers: packLocations.length, algorithms: list.algorithms.length, results, vectors: vectors.size, semanticSig }
    const manifestBytes = Buffer.from(canonical(manifest))
    const manifestSig = sign(manifestBytes)
    await writeArtifact(manifestSig, manifestBytes)
    await writePointer('heuristics:exports', 'current', manifestSig, true)
    const receipt = { destination, ...manifest, manifestSig, skipped: false }
    await fsp.writeFile(packStatePath, JSON.stringify(packState, null, 2) + '\n')
    await fsp.writeFile(statePath, JSON.stringify({ semanticSig, destination, receipt }, null, 2) + '\n')
    await this.recordHistory('export', { semanticSig, manifestSig })
    return receipt
  }

  watch(onAudit = () => {}) {
    const pending = new Map()
    let work = Promise.resolve()
    let historyTimer
    let historyStats = cloneStats(this.stats)
    let historyResults = resultCounts(this.index)
    let historyDirty = false
    const checkpoint = async () => {
      historyTimer = null
      if (!historyDirty) return
      historyDirty = false
      const currentResults = resultCounts(this.index)
      await this.recordHistory('watch', {
        delta: statsDelta(this.stats, historyStats),
        discoveries: countDelta(currentResults, historyResults),
      })
      historyStats = cloneStats(this.stats)
      historyResults = currentResults
    }
    const scheduleCheckpoint = () => {
      historyDirty = true
      if (!historyTimer) historyTimer = setTimeout(() => checkpoint().catch(error => onAudit(error, null, this.stats)), this.historyCheckpointMs)
    }
    const watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const relative = String(filename).replaceAll('\\', '/')
      if (relative.split('/').some(part => DEFAULT_IGNORES.has(part))) return
      if (WATCH_IGNORED_PREFIXES.some(prefix => relative.startsWith(prefix))) return
      clearTimeout(pending.get(relative))
      pending.set(relative, setTimeout(() => {
        pending.delete(relative)
        const absolute = path.join(this.root, relative)
        work = work.then(async () => {
          try {
            const scannedBefore = this.stats.filesScanned
            await this.auditFile(absolute)
            await this.save()
            if (this.stats.filesScanned > scannedBefore) scheduleCheckpoint()
            onAudit(null, relative, this.stats)
          } catch (error) { onAudit(error, relative, this.stats) }
        })
      }, 250))
    })
    return {
      close() {
        watcher.close()
        for (const timer of pending.values()) clearTimeout(timer)
        if (historyTimer) clearTimeout(historyTimer)
        if (historyDirty) checkpoint().catch(() => {})
      },
    }
  }
}

module.exports = { HeuristicService, DEFAULT_IGNORES, WATCH_IGNORED_PREFIXES, MAX_FILE_BYTES, HISTORY_LIMIT, PACK_THRESHOLD_BYTES, PACK_TARGET_BYTES, PACK_CATALOG_RECORD_BYTES }
