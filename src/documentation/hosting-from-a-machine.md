# Hosting from a machine

A host is a directory of static files answered over HTTP, and nothing else —
[`hypercomb-shim/host/README.md`](../hypercomb-shim/host/README.md) states the
contract and [`check-host.mjs`](../hypercomb-shim/host/check-host.mjs) tests it.
This page is about the machines that can *be* one, and in particular about the
Windows, macOS and Linux client, which can now serve its own hive without
exporting anything.

## Three ways to run a host

| | What it serves | Good for |
|---|---|---|
| **Cloudflare Pages** — `npm run host:deploy` from `hypercomb-shim/` | a published folder | a zone, a CDN edge, free, nothing to operate |
| **`node host/serve.mjs dist 4270`** | a published folder | local development, and the shortest statement of the contract |
| **`hypercomb-serve` / Hive ▸ Serve This Hive** | **a live hive, read out of the store** | your own machine, a LAN, a server holding a hive |

The first two serve *a copy*. The third serves the hive itself.

## Serving live, from the store

`hypercomb-client/crates/serve` maps the interchange form onto URLs and answers
each request out of the open store:

```text
GET /                     the shell               (a staged shim build)
GET /pin                  the bootstrap pin       (a staged shim build)
GET /content/<sig>        the bundled packages    (a staged shim build)
GET /<sig>                content bytes           THE STORE
GET /<bagSig>/00000007    a revision marker       THE STORE
GET /<poolSig>/<member>   a pool member           THE STORE
GET /a/deep/hive/location the shell, 200          (a location is not a file)
```

Nothing is exported first, and there is no second copy to keep current. A hive
edited a second ago is the hive being served — the question "did I remember to
re-publish" is not askable.

There is **no write path**. A host publishes; it does not accept. Every byte a
reader takes is checked against its own signature at the admission boundary, so
a hostile, hijacked or simply misconfigured origin can cost a reader a 404 and
never a wrong answer. That is what makes a dumb host safe, and it is also why a
clever one buys nothing.

### Two rules the code is shaped around

Both are in the shim's host README, and both fail *silently*:

1. **A real file wins before any rewrite.** Signature-named files have no
   extension, and the usual SPA heuristic ("no extension ⇒ it's a route")
   rewrites them to `index.html`. The origin then serves its own heap as HTML.
2. **A miss inside a signature is a real 404, never the shell.** A replicating
   node fetches `/<bagSig>/00000007` and writes back whatever it gets — and
   markers are *not* content-addressed, so nothing downstream would catch an
   `index.html` answer. It would land in the reader's own lineage bag. Both the
   native host and `serve.mjs` 404 anything under a sig-named directory.

## On the desktop

**Hive ▸ Serve This Hive.** It binds every interface on the first free port in
4270–4279 and reports the address to hand out. **Hive ▸ Stop Serving** ends it,
and quitting the app ends it too.

The menu is the only way in: the renderer cannot start a host, choose a port or
learn the address. Adopted content runs in that renderer, which is the reason
for the rule.

The shell a visitor's browser boots is a staged shim build, bundled as a Tauri
resource:

```bash
npm run build:shim                                    # from src/
node hypercomb-client/scripts/stage-host-shell.mjs
```

Both CI workflows for the client do this before bundling, so an installer from a
run carries it. A build without it says so plainly instead of serving something
broken.

## On a server

`hypercomb-serve` is the same host with no window:

```bash
hypercomb-serve --hive /var/lib/hypercomb/hive --shell /srv/hypercomb/shell --port 4270
```

`--shell` is a built `hypercomb-shim/dist` copied to the server; `--hive` is a
hive directory. It terminates no TLS and has no configuration language, because
a host has no secret, no session and no request whose answer depends on who is
asking — certificates, virtual hosts and rate limits belong to whatever sits in
front of it.

```caddy
hive.example.com {
    reverse_proxy 127.0.0.1:4270
}
```

```ini
# /etc/systemd/system/hypercomb-host.service
[Service]
ExecStart=/usr/local/bin/hypercomb-serve --hive /var/lib/hypercomb/hive --shell /srv/hypercomb/shell
Restart=always
User=hypercomb
```

**One writer per hive.** The store is a single memory-mapped database and the
desktop app holds it open while it runs. Point the headless host at a hive
nothing else has open — a server's own hive, or a replica restored from a
backup folder.

## Verifying it

The same checker, whatever is serving:

```bash
node hypercomb-shim/host/check-host.mjs http://your-host:4270
```

Eleven checks; each one is a failure mode that otherwise presents as a
*different* problem than the one you have. It is a gate in all three client
workflows, run against the real binary and a fresh hive, so a host that breaks
the contract fails the build rather than a visitor.

## Where `build:essentials` fits

A recurring confusion, so plainly:

- **`npm run build:essentials` is local.** It bundles the modules into
  signature-named files, then copies them into `hypercomb-web/public/content/`
  and `hypercomb-relay/content/`. Nothing leaves the machine. It is what feeds
  the dev server, and — via `stage-host-shell` picking up a shim build that
  carries them — what a native host publishes as its packages.
- **`npm run deploy:essentials` moves no bytes.** Since Azure blob storage was
  dropped it is the same build plus `stamp-install-channel.ts`, which advances
  the signed `install:essentials` pointer in the publisher's hive index over the
  bridge. It publishes a *pointer*, not a payload.
- **Bytes reach the world by replication.** A reader pulls them from a host and
  verifies each one against its signature. Which host is a question about the
  network, not about the build — a Pages deployment, someone's laptop on a LAN,
  or a server running `hypercomb-serve`.

## Related

- [`hypercomb-shim/host/README.md`](../hypercomb-shim/host/README.md) — the
  contract, and what to do when the host is not Cloudflare
- [native-client.md](native-client.md) — the desktop client itself
- [read-only-deployment.md](read-only-deployment.md) — publishing a creation to
  its own domain
- [network-architecture.md](network-architecture.md) — participants, hosts and
  content flow
