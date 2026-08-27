import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { watch } from 'node:fs'
import { buildWeb, OUTPUT_ROOT, SOURCE_ROOT, WEB_ROOT } from './build.mjs'

const option = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const port = Number(option('--port') ?? 4250)
const host = option('--host') ?? 'localhost'
const reloadClients = new Set()

const MIME = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const exists = async path => {
  try { await access(path); return true }
  catch { return false }
}

const safeFile = pathname => {
  const candidate = resolve(OUTPUT_ROOT, pathname.replace(/^[/\\]+/, ''))
  const inside = candidate === OUTPUT_ROOT || candidate.startsWith(`${OUTPUT_ROOT}${sep}`)
  return inside ? candidate : null
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`)
    if (url.pathname === '/__hc_reload') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      })
      response.write(': connected\n\n')
      reloadClients.add(response)
      request.on('close', () => reloadClients.delete(response))
      return
    }

    let file = safeFile(decodeURIComponent(url.pathname))
    if (!file) {
      response.writeHead(403).end('forbidden')
      return
    }
    if (await exists(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html')
    if (!(await exists(file))) {
      const acceptsHtml = request.headers.accept?.includes('text/html') ?? false
      if (!acceptsHtml) {
        response.writeHead(404).end('not found')
        return
      }
      file = join(OUTPUT_ROOT, 'index.html')
    }

    const type = MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': type,
    })
    createReadStream(file).pipe(response)
  } catch (error) {
    console.error('[web-serve] request failed', error)
    if (!response.headersSent) response.writeHead(500)
    response.end('internal server error')
  }
})

let rebuilding = false
let queued = false
let debounce = null

const rebuild = async () => {
  if (rebuilding) { queued = true; return }
  rebuilding = true
  try {
    do {
      queued = false
      await buildWeb({
        production: false,
        clean: false,
        copyStatic: true,
        liveReload: true,
      })
    } while (queued)
    for (const client of reloadClients) client.write(`data: ${Date.now()}\n\n`)
  } catch (error) {
    console.error('[web-serve] rebuild failed; keeping the last good output', error)
  } finally {
    rebuilding = false
  }
}

const queueRebuild = () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => { debounce = null; void rebuild() }, 120)
}

await buildWeb({
  production: false,
  clean: true,
  copyStatic: true,
  liveReload: true,
})

const watchRoots = [
  join(WEB_ROOT, 'src'),
  join(WEB_ROOT, 'public'),
  join(SOURCE_ROOT, 'hypercomb-core', 'src'),
  join(SOURCE_ROOT, 'hypercomb-shared'),
  join(SOURCE_ROOT, 'shared-public'),
]
const watchers = watchRoots.map(root => watch(root, { recursive: true }, queueRebuild))

server.listen(port, host, () => {
  console.log(`[web-serve] http://${host}:${port}/`)
  console.log('[web-serve] plain ESM watch server — no Angular, no Vite')
})

const close = () => {
  for (const watcher of watchers) watcher.close()
  for (const client of reloadClients) client.end()
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
