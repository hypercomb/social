# Hosting a Hypercomb node

A host is a directory of static files. There is no server-side execution
anywhere in the path — `dist/` **is** the host, and serving it is the whole job.

```bash
npm run build                                   # from hypercomb-shim/
npm run host:deploy -- --project my-hive        # Cloudflare Pages
npm run host:check  -- https://my-hive.pages.dev
```

That is the seamless path. The rest of this file is what to do when it is not
Cloudflare, and why each rule exists.

---

## Why static, and not a server

> **Deployments are artifacts.** Nothing is ever "running" at a domain — a
> deployment is a static, signed artifact that clients import, and execution
> happens only in clients.
> — [everything-is-a-beehavior.md](../../documentation/everything-is-a-beehavior.md)

Every byte a host serves is content-addressed and **verified by the reader**
before it is admitted. That is what makes a dumb host safe, and it is also what
makes a clever one pointless: a hostile, hijacked, or misconfigured origin can
only ever cost a 404, never a wrong byte. A host has no secret, no session, no
state, and no request whose answer depends on who is asking.

So: no containers, no instances to turn on and off, no origin to patch or page
someone about. A CDN edge is strictly better at this than a server, and free.

**The shim needs no Worker either.** The blossom-worker exists for the
publish/visitor path — the R2 heap, site bindings, `Sec-Fetch-Dest` MIME
negotiation. None of that applies here, because the shim never bare-URL-imports
an extension-less file:

| what | how it resolves | needs server logic? |
|---|---|---|
| `@hypercomb/core`, `pixi.js` | `/…runtime.js` — real extension | no |
| dependencies | `/opfs/<pool>/<sig>` — **the service worker sets the type** | no |
| the bootstrap bundle | **blob import**, after verification | no |
| content atoms | `fetch()` + sha256; never imported | no |

Putting a Worker in front bills an invocation per asset against a daily quota.
That is the shape of an outage where every site dies at once and recovers at UTC
midnight — pay it only where it buys something.

---

## The contract

Seven rules. `check-host.mjs` tests all of them against a live URL.

1. **Serve `index.html` and `main.js` at the root.**
2. **Publish `/pin`** — one 64-hex signature naming the bootstrap bundle — and
   serve the bundle it names. The pin is the single mutable pointer in the whole
   chain; everything it names is content-addressed.
3. **A real file always wins, before any rewrite.** ← *the rule everything gets
   wrong.* See below.
4. **Unknown paths serve `index.html` with 200.** A hive location is not a file.
   But a missing *signature* must be a real 404.
5. **`Access-Control-Allow-Origin: *` on content.** A host exists to be pulled
   FROM.
6. **Never hard-cache `/pin`, `hypercomb.worker.js`, `main.js`, `env.js`.**
   Signature paths may be cached forever — the name IS the hash.
7. **Never serve outside the root.**

### Rule 3 is the one that bites

Signature-named files have **no extension**. Every off-the-shelf SPA server uses
"no extension ⇒ it's a route" as its heuristic and rewrites them to
`index.html`. The origin then serves its own heap as HTML: `/pin` answers
`<!doctype`, atoms fail their hash, and the host looks *corrupt* rather than
misconfigured.

This is not hypothetical — `serve --single` fails exactly here, and the checker
caught it:

```
[ FAIL ] publishes /pin — <!doctype ht…
[ FAIL ] atom bytes hash to their name — 0306efe8336a… served 9b9d8ed55464…
```

Cloudflare Pages gets this right natively (assets are matched before
`_redirects`). If you are configuring anything else, this is the rule to check
first.

### Rule 5 is the one that looks like something else

Without CORS, replication from another origin dies as an opaque
`TypeError: Failed to fetch` — no status, no diagnosis — and the host looks
exactly like one that publishes nothing. `*` is correct rather than lax: the
bytes are public, immutable, content-addressed, and verified by the reader, so
there is no request whose origin changes the answer.

---

## Cloudflare Pages

`public/_headers` and `public/_redirects` ship in the build and Pages reads both
natively, so the contract is satisfied by uploading `dist/`.

```bash
npm run host:deploy -- --project my-hive --domain hive.example.com
```

The script shells out to `wrangler` and **never asks for, prints, or stores a
token** — wrangler reads `CLOUDFLARE_API_TOKEN` from the environment or uses an
existing `wrangler login` session. To set someone up on *their* account, they
run it with their own token. Nobody hands a credential to anybody.

Token scopes: **Account · Cloudflare Pages · Edit**, plus **Zone · DNS · Edit**
only if you pass `--domain`. If the zone lives in another account the script
prints the CNAME to create rather than pretending it can do it.

The deploy verifies itself when it finishes. A brand-new custom domain often
needs a minute for DNS and its certificate — re-run `host:check` if it does not
pass immediately.

## A machine that already holds the hive

Everything above serves a *folder*. The Windows, macOS and Linux client serves
the hive itself — same contract, same checker, answered live out of its store
with no export step in between:

```text
Hive ▸ Serve This Hive                              (the desktop app)
hypercomb-serve --hive <dir> --shell <dist>          (a server, no window)
```

The shell it serves is a staged copy of this `dist/`, so the two are not
alternatives so much as the same host pointed at a different heap. See
[hosting-from-a-machine.md](../../documentation/hosting-from-a-machine.md).

## Anything else

[`serve.mjs`](serve.mjs) is a complete, correct host in about forty lines of
dependency-free Node. It is the local dev server, and it is also the shortest
statement of the contract — read it if you are configuring nginx, Caddy, S3, or
a container.

```bash
node host/serve.mjs dist 4270
node host/check-host.mjs http://localhost:4270
```

For other static hosts the pieces map over directly: `_headers` → nginx
`add_header` / Netlify `_headers` / S3 metadata; `_redirects` → a `try_files`
that checks the file first. **Test with `check-host.mjs` rather than by eye** —
every rule above fails silently, and several of them fail as a *different*
problem than the one you have.
