# Mail on hypercomb.com — the mail Worker

**Status 2026-11-05.** The Worker `hypercomb-mail` is DEPLOYED on `hypercomb.com/mail/*` with its private bucket
`hypercomb-mail`, and sending is proven end to end: a signed `POST /mail/send` as `jaime@hypercomb.com` reached
Gmail's inbox (not Spam), `mailed-by cf-bounce.hypercomb.com`, `signed-by hypercomb.com`, TLS, and the sealed Sent
copy read back through the live Worker. That proof used a throwaway key, since deleted; the sealed test copy
(sealed to that key) is still in the bucket.

**Owner key set 2026-11-05 (jwize: "device key + Gmail copy").** The `MAIL_CONFIG` secret (until 2026-11-06 the
`MAIL_KEYS` var) maps `jaime@hypercomb.com` to `eacc0e65…` — the key the public ledger (`directory.hypercomb.com/publications.json`) lists as "Jaime", the
publisher key of his hive's signer. It was **taken from that public ledger, not read from his device**: the
mail window must confirm it (it shows "This device's key does not own a mailbox" with the key if it differs)
BEFORE the Email Routing rule is switched, because mail sealed to the wrong key can never be opened. The Worker
is redeployed with `GET /mail/me`. Only the holder of that private key can read the box or send as jaime@; a
stranger's key gets `[]` from `/mail/me` and 401 elsewhere (checked live). `COPY_TO` still copies every message
to Gmail.

**The jaime@ rule was switched 2026-11-06 (jwize: "yes, switch").** The Email Routing rule for
`jaime@hypercomb.com` (id `bb9aebae…`) went from "forward to hypercomb.io@gmail.com" to "send to the Worker
`hypercomb-mail`"; read back from Cloudflare afterwards, catch-all untouched. Incoming mail is now sealed into the
bucket AND copied to Gmail (`COPY_TO`). The key was confirmed first: his 4250 mail window found jaime@ and showed an
empty inbox. UNDO: put the rule back to `forward ["hypercomb.io@gmail.com"]` (dashboard: Email Routing -> Routing
rules -> Actions -> Edit). A raw `PUT` of the rule from a page script is refused (403); the dashboard's own editor
works (edit needs an explicit Save, unlike create). `leanne@` has no rule yet.

**Trying the client in the dev hive (2026-11-05).** Nothing was published. `hypercomb-dev/src/app/app.ts` imports
the side-effect barrel from SOURCE, so after `node ../node_modules/tsx/dist/cli.mjs ./scripts/prepare.ts` (run in
`hypercomb-essentials/`, prepare alone — not the anatomy/glossary generators, and not `build:essentials`, which
cleans `dist-lib` under a running dev server) the barrel gained `import './mail/mail.queen'` and
`'./mail/mail.view'`, and the running `ng serve` on :4250 (live reload off) rebuilt and now serves the word and
the window (a lazy chunk). Reload the 4250 tab, type `mail`. The Worker's `ALLOWED_ORIGINS` now also holds
`http://localhost:4250`. The key at that origin is the one the stamp signs with (`eacc0e65`, per the install
stamp notes); `hypercomb.io` is a different origin and holds its own device key.

The mail server is a Cloudflare Worker (`hypercomb-relay/mail-worker/`). It is always up, so mail never
waits on a machine being on. A mail server of the usual kind cannot live behind a tunnel or on a home
connection (the mail port is not web traffic, home addresses are refused or marked as spam), so
Cloudflare Email Routing takes the mail port and hands each message to this Worker over the inside.

## The path

```
sender's mail server
  → Cloudflare Email Routing          (the MX records point here)
  → email()  in mail-worker/worker.js
  → encrypted to the recipient's key, filed in the private R2 bucket
reader in the hive
  → GET hypercomb.com/mail/box/<address>[/<sig>]   (signed request from the owner's key)
```

## What the bucket holds

Per recipient, pool = sha256(`mail:<address>`) — a pool of meaning, derived, never a typed folder:

- `<pool>/<sig>` — the **sealed envelope**; `sig` is the sha256 of the message. `customMetadata` carries
  `at` (arrival time) and `meta` (who, subject, size — sealed too).
- A message to two recipients is two objects, each sealed to its own recipient's key.
- A replay changes nothing: the first arrival time stands.

**Sealing** (`seal.js`): the message is encrypted with a fresh AES-256-GCM key, and only that 32-byte key
is wrapped to the recipient's Nostr key with NIP-44 (NIP-44 itself takes at most 65,535 bytes). The
bucket holds ciphertext; only the holder of the private key reads it, and a tampered envelope refuses to
open. The Worker does see each message in the clear while `email()` runs — that is inherent to receiving
mail at all — and the Gmail copy, where listed, is plain at Google.

**Reading** needs a signed request (NIP-98, `nip98.js`) from the one key registered for that address.
An unknown mailbox and a wrong key answer the same 401, so the answer never says which addresses exist.
CORS answers only the origins in `ALLOWED_ORIGINS`.

## When something fails

Per recipient (`COPY_TO` is a map, never one shared address):

| stored | copy address listed | result |
|---|---|---|
| yes | yes | sealed in the bucket and a copy forwarded |
| yes | no | sealed in the bucket |
| no (bucket down, too large) | yes | the copy catches it |
| no | no | rejected, so the sender gets a bounce — never lost silently |

An address with no valid key is not a mailbox: its mail is copied if a copy is listed, else bounced.
There is no "try again later": an Email Worker can only reject permanently.

## Sending

Sent through Cloudflare Email Sending (beta, Workers Paid), which `hypercomb.com` was **onboarded to on
2026-11-05**. That added records on the `cf-bounce` subdomain (MX, SPF, DKIM) and a domain-wide
`_dmarc.hypercomb.com` = `v=DMARC1; p=reject;`. Cloudflare locks those records. The reject policy means a
receiver is told to refuse mail claiming to be from `@hypercomb.com` that fails SPF/DKIM: Email Sending
signs correctly, but any *other* service that sends as `@hypercomb.com` must be authorised first or its
mail is refused. The receiving records on the root are unchanged.

`POST /mail/send` (JSON body, signed with a payload tag naming the sha256 of the exact body):

- `from` must be an address in `MAIL_KEYS`, and the signing key must own it. `to` (required), `cc`, `bcc`:
  up to 20 addresses in all. `subject` (no line breaks), `text` and/or `html`, optional `replyTo`,
  `inReplyTo` and `references` (message ids, for threading).
- 200 → `{ messageId, sig }`; the sealed copy is filed in the sender's Sent folder (`GET /mail/sent/<address>`).
  If Cloudflare refuses, only its error code is passed on (429 for limits, 422 for a refused sender,
  recipient or header, 502 otherwise) and nothing is filed as sent.
- A per-address daily cap (`MAX_SEND_PER_DAY`, default 100) is counted before the send. It is a brake on a
  leaked key, not accounting. If the bucket cannot count, nothing is sent.
- No attachments yet. Threading headers are dropped, not the mail, if Cloudflare will not carry them
  (unverified until a real send).
- Sends to your own verified destination addresses do not count toward Cloudflare's quota, so the first
  test send can go to `hypercomb.io@gmail.com`.

## Limits

- **15 MiB per message stored** (`MAX_STORE_BYTES`): the Worker holds a message in memory (128 MB), and
  encrypting it holds it twice. Bigger ones are copied or bounced. Cloudflare Email Routing takes up to 25 MiB.
- **Hive reader only.** A standard mail app (Outlook, Thunderbird) needs IMAP, a different kind of server.
- Losing the private key loses the mail: the server cannot open it.
- `hypercomb.com/mail/*` is claimed by this Worker; check the apex card has no page of that name.

## Going live — each step touches something live and needs the owner's say-so

1. `wrangler r2 bucket create hypercomb-mail` (a private bucket; nothing public).
2. Set the one secret, `MAIL_CONFIG` (`wrangler secret put MAIL_CONFIG`, JSON `{ keys, copyTo }`): under
   `keys`, each address → the **hex Nostr public key** of its owner — the key whose private half the reader
   will hold; under `copyTo`, each address → a verified copy address, if wanted. Nothing personal goes in
   `wrangler.toml` (the repository is public); the secret survives every deploy. Add any dev origin to
   `ALLOWED_ORIGINS` in the toml.
3. From `mail-worker/`: `wrangler deploy`. The route `hypercomb.com/mail/*` is more specific than the
   apex route on `pluginthematrix-core`, so the live Worker is untouched.
4. In Cloudflare Email Routing change the `jaime@hypercomb.com` rule from "Send to an email" to
   "Send to a Worker" → `hypercomb-mail` (the same for `leanne@`).
5. Test: mail the address from another account; confirm an object under the pool; read the list with a
   signed request and open one.
6. Test sending: a signed `POST /mail/send` as `jaime@hypercomb.com` to `hypercomb.io@gmail.com`; check the
   headers in Gmail show SPF, DKIM and DMARC passing, and that the Sent folder holds the sealed copy.

## The client in the hive

`hypercomb-essentials/src/mail/` — built and tested (78 specs, including the real client against the real
Worker code), **not yet published to a shell**. The word `mail` opens the window (`mail.queen.ts`, the
domain's one behaviour; `mail` is listed in `atomized-roots.json`). Files:

| file | does |
|---|---|
| `mail.queen.ts` | the word; opens the window, never sends; registers the surface tag (order 145) |
| `mail.view.ts` | the window: inbox, Sent, a message, a draft. Everything is `textContent`; nothing is stored |
| `mail.service.ts` | talks to `hypercomb.com/mail/*`; signs every request through the hive's `NostrSigner` |
| `envelope.ts` | opens a sealed message; only ever hands the signer the wrapped key |
| `mime.ts` | reads one message: encoded headers, multipart, attachments by name, inline images |
| `mail-html.ts` | makes a stranger's HTML safe: an inert parse, then a script-less sandboxed frame whose own policy loads nothing but a `data:` image |
| `reply.ts` | drafts a reply (thread headers capped), reply-all |

Rules it keeps: the key is never read, stored or exported (the signer does the signing and the one decryption
step); opening mail never mints a key (a device without one is told so); remote images, backgrounds and
stylesheets are never loaded (`no-third-party-requests.md`), and the window says how many were held back;
sending is a press on Send, never a word typed at the command line; only `hypercomb.com` is contacted.

**Which key owns a mailbox.** The hive's `NostrSigner` holds a **device key in this browser profile's
storage** (or defers to a NIP-07 extension), and by decision it is never exported. A mailbox sealed to it can
only be read on that profile: clearing site data, or opening mail on another device or origin, makes the
stored mail unreadable. Until there is a backup story, keep the Gmail copy (`COPY_TO`). A device whose key
owns no mailbox yet shows its public key in the window ("Copy key"), which is what goes in `MAIL_KEYS`.
`localStorage` is per origin, so the hive on `hypercomb.io` and a dev origin hold DIFFERENT keys.

## Not built

- **Publishing the client** to a shell (`npm run publish:revision`), and the side-effect barrel
  (`side-effects.ts`) is regenerated by the build's prepare step, not by hand.
- Hiding or deleting a message, attachments (listed, not opened or sent), spam filtering, a key backup,
  keeping a copy on a home machine.

## The home-machine variant

`hypercomb-relay/mail-inbox.js` is the same idea on the relay (a private directory, not the content root,
which `relay.js` serves publicly). It stays as an optional place to hold a replica; it is not wired in.
