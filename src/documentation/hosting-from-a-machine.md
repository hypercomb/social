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

A swarm's meeting point is a fourth kind of machine host, and the only one
that accepts writes: [the meeting point](#the-meeting-point-relayjs-as-a-swarms-host)
below.

## Serving live, from the store

`hypercomb-client/crates/serve` maps the interchange form onto URLs and answers
each request out of the open store:

```text
GET /                     the shell               (a staged shim build)
GET /pin                  the bootstrap pin       (a staged shim build)
GET /content/<sig>        the bundled packages    (a staged shim build)
GET /<sig>                content bytes           THE STORE
GET /<floorSig>/          a floor pool listing    THE STORE + staged shell
GET /<floorSig>/<member>  a member it lists       THE STORE + staged shell
GET /<bagSig>/<head>      a bag's HEAD marker     THE STORE
GET /a/deep/hive/location the shell, 200          (a location is not a file)
```

**Only the genome leaves** (rule 6 of
[layer-pattern-audit.md](layer-pattern-audit.md)). The store behind the host is
the participant's whole hive, so `resolve()` gates it: a directory is listed
only when it is a floor pool from `hypercomb-relay/host-listing.floor.json` —
the same file the relay and the blossom worker list from — and a `document`
floor pool lists only its head marker and the atom it names. Every other
directory (a tile's bag, any other pool) answers `404 pool not held`, exactly
as an absent one, and gives up its head marker and nothing else: no earlier
marker, no member. Operator-declared `listed` pools are not served by this
host yet.

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

## The meeting point: relay.js as a swarm's host

`hypercomb-relay/relay.js` behind a Cloudflare tunnel is a swarm's meeting
point (`wss://jwize.com`) and a flat content heap (`https://jwize.com/<sig>`).
Unlike the hosts above, it accepts writes: from its `--writers`, and, with
`--allow-participants`, from the live participants of any swarm that meets on
it. The doctrine, the caps and the meeting runbook are in
[swarm-host.md](swarm-host.md). This replaces the guest recipe of 2026-10-04
(join, pick a host, `publish here`): a guest now only joins. Since 2026-10-07
the relay is a participant's upload host only when they name none themselves
(no publish domain on the page, an empty hosts pool); to make it a meeting
page's host for everyone, give that page the relay's zone as a publish domain
(`host:<zone>`).

### The NSSM line

On jwize's machine the relay is the NSSM service `hypercomb-relay`. Its
AppParameters gain one flag, and nothing else changes:

```powershell
nssm get hypercomb-relay AppParameters
nssm set hypercomb-relay AppParameters "C:\Projects\hypercomb\social\src\hypercomb-relay\relay.js --port 7777 --content-dir C:\Projects\hypercomb\social\src\hypercomb-relay\content --writers <the existing writer keys> --allow-participants"
```

- Read the current line first and append the flag. Keep `--port 7777`,
  `--content-dir`, `--writers` and any `--shell-dir` exactly as they are.
- `--allow-participants=<lifecycleSig>,...` hosts only the rooms listed. Each
  new room then needs a restart.
- Restart cleanly with `hypercomb-relay/fix-relay-elevated.ps1`, elevated. It
  kills the wrapper tree, frees port 7777 and starts the service. A bare
  `nssm restart` can leave an orphan listener, and the new instance then dies
  with EADDRINUSE.
- A restart empties the relay's memory: events, wills, hive indexes and the
  map of live participants. Clients reconnect and reassert within seconds, and
  the bytes on disk are untouched. Still, restart at least 24 h before a
  meeting.
- To roll back, remove the flag and restart. Participants then share names
  only, and their status line says the host isn't taking uploads.

### A meeting point behind an access code

To run a relay.js for someone else's meetings behind a code that can be
recycled (jwize, 2026-10-09: "just allow an access code that can be
recycled"):

```powershell
node relay.js --new-access-code C:\hypercomb\access-codes    # prints the code ONCE; the file keeps only sha256(code)
# then add to the service's AppParameters:
#   --access-codes C:\hypercomb\access-codes                  (or env ACCESS_CODES)
```

- The code rides the dial as the WebSocket subprotocol `hc-access.<code>` —
  no extra round trip. A dial without a listed code is closed **4401** before
  any frame. Hand the code out only inside meeting links (`&relay=…&code=…`,
  swarm-host.md, "The meeting link").
- **Recycle** with `--new-access-code <file>` again: the new code in, the old
  one out, in force within a second on the running relay, and every session
  that came in on a code no longer listed is closed. No restart, no redeploy.
  `--destroy-access-codes <file>` empties the file: nobody is admitted.
- The code itself is never on disk, in a log or in the census line. Without
  `--access-codes`, a relay ignores the subprotocol (and echoes it, so a
  browser still connects): the home relay stays open.

### The NIP-11 check

```bash
curl -s -H "Accept: application/nostr+json" https://jwize.com
```

`limitation.participant_uploads` is `"all"` for the bare flag, `"zones"` for a
room list, and `false` when the flag is off. `max_addresses` (16),
`restricted_writes` and `access_code` say the address gate and the door are
in force (swarm-host.md, "Reads name an address"). Then run
`node scripts/swarm-preflight.cjs` from `src/`. It proves one participant
upload end to end with a throwaway key.

The machine itself needs Ethernet, no sleep and no shutdown on meeting days:
see the runbook in [swarm-host.md](swarm-host.md).

## Leaving the hive in the swarm while you are away: `keep-alive`

An idle participant does not drop: no code watches for input, and the swarm
beacon refreshes on its own timer (about every 60 s against a 90 s expiry). What
does take a hive out is the computer sleeping (the relay reaps the socket and the
others see you leave) and the browser freezing a tab it thinks nobody is using.

`keep-alive` (toggle; `keep-alive on`, `keep-alive off`) covers the hive's half
(jwize 2026-10-09: "so I can leave it as a host for some data and go away from
my computer"):

- it holds the browser's **screen wake lock**, so the operating system does not
  dim, lock or sleep while the hive tab is showing, and asks again whenever the
  tab shows (the browser releases the lock whenever the tab is hidden);
- it **pulses the hive every 25 s**, so the beats that only run on a pulse (the
  meeting's 30 s availability) keep running with nobody touching the page;
- it is **remembered on this device** (`swarm:keep-alive` pool), so a reload or
  an update keeps it on. It never travels with content.

The machine's half is a setting, once:

- keep the hive tab **showing** — the active tab of a window that is not
  minimised (the hive's own screensaver is fine);
- in Edge, add the hive's address to **Settings → System and performance →
  Never put these sites to sleep** (sleeping tabs freeze inactive background
  tabs, after 5 minutes when efficiency mode is on);
- a closed laptop lid sleeps the machine whatever the page asks.

## Moving your root off the machine: the machine joins the farm

*jwize, 2026-10-07:* "You can move the hosting role over to
pluginthematrix.io/com … you can have the redundancy and start a little
farm." A root domain is a front door ([using-a-creation.md](using-a-creation.md),
"Your root, your entrances, and the community farm"), so it moves to the host
worker, and the machine keeps serving under a name of its own. For
`jwize.com` that name is `relay.pluginthematrix.io`.

The host worker carries the machine's two jobs over, both set per domain in
`SITE_BINDINGS` (`wrangler.pluginthematrix.toml`):
- **`relay`**: a WebSocket upgrade on the root is passed through unchanged to
  that host, so builds already shipped keep meeting at `wss://jwize.com`.
- **`farm`**: a signature the worker's storage lacks is read from each farm
  host in turn, checked against its name, served, and kept, so the next read
  is local. A signature is a right to use; nothing else is ever read through.

**Still tied to the machine:** the relay itself (a meeting needs it on), and
any bytes only it holds until they are read once or copied. Until the relay
runs somewhere always on, a demo needs the machine awake.

**What changes after the move:** uploads at `https://jwize.com/<sig>`,
including a meeting's, land in the worker's storage under its upload rules
(`AUTO_GRANT`), not the relay's live-participant rule.

### The cutover, in order

Each step is the owner's act; nothing here deploys by itself.

1. **Workers Paid** on the Cloudflare account ($5 a month). It removes the
   100,000-requests-a-day cliff that takes every site down at once.
2. **Deploy the worker** with the entrance, relay and farm code
   (`npm run deploy:pluginthematrix` in `hypercomb-relay/blossom-worker`). It
   changes nothing until a binding or a signed index asks for it.
3. **Give the machine its own name.** The ingress for
   `relay.pluginthematrix.io` is already in `~/.cloudflared/config.yml`. Add
   its DNS route, then restart the tunnel:
   ```bash
   cloudflared tunnel route dns 88ceb5a9-fd5f-47de-9fd1-9bb8be2c3e7d relay.pluginthematrix.io
   ```
   Check: `curl -s -H "Accept: application/nostr+json" https://relay.pluginthematrix.io`.
4. **Bind and route the root** in `wrangler.pluginthematrix.toml`. Add the route
   `{ pattern = "jwize.com", custom_domain = true }`. In the `jwize.com` binding,
   drop `"routed":false` and add:
   ```json
   "frontDoor":true,"relay":"relay.pluginthematrix.io","farm":["relay.pluginthematrix.io"]
   ```
5. **Free the root from the tunnel.** Remove the `jwize.com` tunnel DNS record
   in the dashboard (it collides with a custom domain at deploy) and the
   `jwize.com` ingress in `config.yml`, then restart the tunnel.
6. **Deploy the worker again**, then check:
   - `https://jwize.com/` answers as a front door;
   - `https://jwize.com/<the current install root>` answers 200, read through
     the farm;
   - `node scripts/swarm-preflight.cjs --relay wss://jwize.com` meets.
7. **Check:** `https://jwize.com/` shows your front door on every device.

The Hyperdex needs none of this cutover. It runs at its own address,
`business-card.jwize.com`, and `*.jwize.com` already reaches the worker, so it
needs only step 2:
1. In your hive, on `/jaime-weise`, open Publish and switch `jwize.com` on.
2. Use the own-address button: type `business-card` and Save.
3. In the `business-card.jwize.com` Entrances block, preview the card page,
   then Turn on.
4. `https://business-card.jwize.com/` now runs your Hyperdex on any device.

**To undo:** remove the route, put back the DNS record and the ingress
(`config.yml.bak-2026-10-07` holds the old file), restart the tunnel, and
deploy.

## Related

- [swarm-host.md](swarm-host.md) — your hosts host the meeting: publish
  domains, then the hosts pool, then a relay that allows participants
- [`hypercomb-shim/host/README.md`](../hypercomb-shim/host/README.md) — the
  contract, and what to do when the host is not Cloudflare
- [native-client.md](native-client.md) — the desktop client itself
- [read-only-deployment.md](read-only-deployment.md) — publishing a creation to
  its own domain
- [network-architecture.md](network-architecture.md) — participants, hosts and
  content flow
