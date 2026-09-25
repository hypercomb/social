// Cloudflare Pages routes unknown URLs to index.html. Machine addresses must
// instead answer their own bytes or 404; a missing pool is never a webpage.
const SIG = /^[a-f0-9]{64}$/
const POOL = /^\/(?:content\/)?([a-f0-9]{64})\/$/
const MACHINE = /^\/(?:content\/)?[a-f0-9]{64}(?:\/(?:[a-f0-9]{64}|[0-9]{8}))?\/?$/
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }

const signed = async (bytes, sig) => {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') === sig
}

export async function onRequest({ request, next, env }) {
  const path = new URL(request.url).pathname
  // A shell-only Pages project can outlive old cached content assets at its
  // default alias. The operator opts into hiding them; hosts that publish
  // content from Pages continue to answer their own pool and atom paths.
  if (env?.HYPERCOMB_SHELL_ONLY === '1' && path.startsWith('/content/')) {
    return new Response(null, { status: 404, headers: CORS })
  }
  const machine = path.startsWith('/content/') || MACHINE.test(path)
  const response = await next()
  if (!machine || !response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response
  }

  // A static pool's index.html is a wire listing, not an HTML document.
  if (POOL.test(path)) {
    const listing = await response.clone().text()
    const names = listing.trim().split(/\r?\n/)
    if (names.length && names.every(name => SIG.test(name) || /^[0-9]{8}$/.test(name))) {
      return new Response(request.method === 'HEAD' ? null : `${names.join('\n')}\n`, {
        status: 200,
        headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  }

  // Signed HTML is legitimate only when its bytes actually match its URL.
  const sig = /^\/(?:content\/)?([a-f0-9]{64})$/.exec(path)?.[1]
  if (sig && await signed(await response.clone().arrayBuffer(), sig)) return response
  return new Response(null, { status: 404, headers: CORS })
}
