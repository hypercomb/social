# Mail — the hive's own email, and the scaffold for anyone to join

**Status 2026-11-07.** This is the one document a newcomer reads. It describes the code in the working tree, which
is **uncommitted, not published as a revision, and not deployed**: the live Worker on `hypercomb.com/mail/*` is the
one deployed on 2026-11-05 and is older than what is described here (see section 7). `inbound-mail.md` keeps the
history of how it went live; `mail-plan.md` is the plan this round was built from; `mail-templates.md` is the
design for templates.

jwize: *"each tile is a building block in the hive; we are building a scaffold for everyone to join in on."*

## 1. What it is, and the doctrine it keeps

Mail you can own. A **host** (any Cloudflare zone) runs a small Worker that receives mail from Email Routing,
**seals each message to its owner's Nostr key** into a private R2 bucket, and sends through Cloudflare Email
Sending. A **participant** reads and writes it from the `mail` window in their hive, signing every request with
the key the hive already holds. The host can store and serve the mail; it cannot read it.

```
sender → Cloudflare Email Routing → email() in the Worker → sealed to the owner's key(s) → private R2 bucket
reader in the hive → signed request (NIP-98) → the sealed bytes → opened in the browser with the device key
write in the hive  → signed POST /mail/send → Cloudflare Email Sending → the recipient; a sealed copy in Sent
```

What it keeps, one line each (axiom ids from `doctrine.codex`):

- **A message is an artifact.** Its signature is the sha256 of its raw bytes, the same in the mailbox and, once
  saved, in the hive; the same bytes are stored once (I1, A6).
- **Each tile is a building block.** A saved message is one tile that carries its own text and its own
  attachments as resources and depends on no other tile; nothing is minted the participant did not press for
  (A1, A2).
- **Nothing contacts a host we do not control.** Reading mail never fetches a remote image, stylesheet or
  tracker, and the window says how many it held back; only the mail host(s) are spoken to (T7,
  `no-third-party-requests.md`).
- **Hide first, delete second.** Delete is refused unless the message is hidden and marked deletable, and on the
  host a delete moves the message to a trash for 30 days rather than destroying it (H4, H2).
- **Pools carry colons.** `mail:<address>`, `mail-sent:<address>`, `mail-draft:<address>`; addresses are derived
  (sha256 of the meaning), never typed in as hex (P1, P2, P4).
- **Old objects keep opening.** Envelope v1 and v2 both open; a v2 list line sealed before it was bound to its
  message still opens (H3).
- **Who lives on a host is a secret, not code.** `MAIL_CONFIG` is set per deployment and survives deploys; the
  repository is public (B1: the module holds the behaviour, the deployment holds the people).
- **One behaviour per feature.** `mail.queen.ts` is the domain's one bee; every other file in `src/mail/` is a
  dependency that exports and never registers (B1, B2).
- **Text through i18n keys, `#private` fields, EventTarget plus `change`, ESM with `.js` imports** (B5, B6).
- **Documentation lives only in `src/documentation`** (B7).

## 2. The scaffold — how you join

| you are | you do | you need |
|---|---|---|
| **a host** | deploy the Worker on your zone, set one secret, point Email Routing at it, onboard Email Sending | a Cloudflare zone, Workers Paid (Email Sending is beta), `wrangler` |
| **a participant** | open `mail` in your hive; give the host the public key the window shows | your own hive; nothing else |
| **a developer** | add an atom to `src/mail/` and wire it in the window | the file map below |
| **another client** | speak the wire contract | the contract below |

The client talks to **any mail host**. For an address it has not learned, it asks `https://<the address's
domain>` first, then the hosts it was given (default `https://hypercomb.com`); a host that does not answer a mail
path (a static host answering 200 HTML counts as not answering) is skipped, and a send that got no answer is
never retried on another host, because it may already have gone out (`mail.service.ts`).

### 2a. A host

Everything lives in `hypercomb-relay/mail-worker/` (`worker.js`, `seal.js`, `nip98.js`, `wrangler.toml`).

1. **Make it yours.** In `wrangler.toml` set `routes` to `<your zone>/mail/*` (the shipped value is
   `hypercomb.com/mail/*`), and `ALLOWED_ORIGINS` to the origins your participants' hives run on (comma-separated;
   none means none). The shipped list is `https://hypercomb.io` and `http://localhost:4250`, the second kept on
   purpose for jwize's dev hive; drop it on your own host.
2. **A private bucket:** `wrangler r2 bucket create hypercomb-mail` (the binding is `MAIL`; nothing is public).
3. **The one secret, `MAIL_CONFIG`** (`wrangler secret put MAIL_CONFIG`), JSON `{ keys, copyTo, names }`:
   - `keys`: address → a hex Nostr public key, or a list of at most **3**. Each entry is `"<hex>"` (may do
     everything) or `{ "key": "<hex>", "can": ["read"] }`. The acts are `read`, `mark`, `draft`, `delete`,
     `send`. A `can` that is not a list means read-only; an unknown word is ignored. Mail is sealed to **every**
     listed key, whatever it may do. An address with no valid 64-hex key is not a mailbox: its mail is copied (if
     `copyTo` names it) or bounced.
   - `copyTo`: address → a verified address that also gets a copy and catches the message if it cannot be
     stored. Per recipient on purpose, so one person's mail is never copied to another's inbox. Add one only once
     Email Routing shows it verified.
   - `names`: address → a display name, sent as `Name <address>` (quotes, angle brackets and backslashes are
     removed; at most 64 characters).
   - For a local dev run the three may be plain vars `MAIL_KEYS`, `COPY_TO`, `MAIL_NAMES`; the secret wins.
4. **Deploy** from `mail-worker/`: `wrangler deploy`. Settings you may tune in `[vars]`: `MAX_SEND_PER_DAY`
   (default 100), `MAX_DELETE_PER_DAY` (200), `MAX_STORE_BYTES` (10 MiB). They are held low until the largest
   receive and send are measured under `wrangler dev` against the Worker's 128 MB (R1 #14).
5. **Purge the trash.** A delete moves a message to `trash/<pool>/<sig>`; nothing in the Worker destroys mail. Set
   the 30-day purge once on the bucket (`wrangler.toml` gives the command):
   `wrangler r2 bucket lifecycle add hypercomb-mail purge-trash trash/ --expire-days 30`. Until that rule exists
   the trash is kept for ever. A restore is an operator copying the object back; there is no restore route.
6. **Email Routing.** In the dashboard (Email Routing → Routing rules) set each address's action to
   **Send to a Worker** → `hypercomb-mail`. Verify any `copyTo` address there first.
7. **Email Sending** (sending only). Dashboard: Email Service → Email Sending → Onboard Domain. That adds
   records on a `cf-bounce` subdomain (MX, SPF, DKIM) and a domain-wide `_dmarc.<zone>` =
   `v=DMARC1; p=reject;`; Cloudflare locks them. **What `p=reject` means for you:** a receiver is told to refuse
   mail claiming to be from `@<your zone>` that fails SPF/DKIM. Email Sending signs correctly, but any *other*
   service that sends as your domain (a newsletter tool, a CRM) must be authorised first or its mail is refused.
   Receiving records on the root are unchanged.
8. **Test.** Mail the address from another account and read the list with a signed request; then send as the
   address to a verified destination of your own (those sends do not count toward Cloudflare's quota).

Each step touches something live and is the host owner's act; none is done by the hive.

### 2b. A participant

Open the hive and type `mail`. The word opens the window and does nothing else (`mail.queen.ts`: it reads
nothing, sends nothing, takes no address). If this device's key owns no mailbox on the host yet, the window says
so and shows the key's **public** half with a **Copy key** button; send that to whoever runs the host, who adds
it to your address under `keys`. It is a public key, safe to share; the secret half never leaves the device and
opening mail never mints one (a device with no key is told so).

The key is the hive's `NostrSigner` device key, kept in this browser profile's storage (or a NIP-07 extension).
`localStorage` is per origin, so the hive on `hypercomb.io` and a dev hive on `localhost:4250` hold different
keys. **Clearing site data, or opening mail on another device or origin, makes sealed mail unreadable.** That is
why a recovery key matters.

**A recovery key** is a second key the host lists for your address, kept **offline** by you. Because mail is
sealed to every listed key, it can open everything that arrives after it is listed if the device key is lost.
Give it `{ "key": "<hex>", "can": ["read"] }` so that if it leaks it cannot hide, delete, draft or send (R1 #6).
Mail that arrived before a key was listed is not sealed to it. Nothing in the repository generates a recovery
key for you: whether and how is each owner's own act.

### 2c. A developer

`hypercomb-essentials/src/mail/`, one atom per file, each with a `*.spec.ts` beside it. Only `mail.queen.ts`
registers; the rest export.

| file | owns |
|---|---|
| `mail.queen.ts` | the word `mail`; opens the window, never sends; registers the surface tag (order 145) and itself in IoC |
| `mail.view.ts` | the window: every pane, the cue, keyboard, compose; everything is `textContent`, nothing is stored |
| `mail.service.ts` | the client's hands: every route below, signing through the hive's `NostrSigner`, hosts, roles, replays, limits (`MAIL_LIMITS`) |
| `envelope.ts` | opens sealed envelopes (v1, v2) and list lines; hands the signer only the wrapped key |
| `mime.ts` | reads one message: headers, multipart, attachments (`attachmentBytes`), inline images, `previewText` |
| `mail-html.ts` | makes a stranger's HTML safe: an inert parse, then a script-less sandboxed frame with its own CSP; counts what it held back |
| `format.ts` | the composer's light marks (`**bold**`, `_italic_`, lists, quotes, links…) into `{ html, text }`, everything escaped |
| `reply.ts` | drafts for Reply, Reply all and Forward |
| `mail-threads.ts` | conversations from Message-ID / In-Reply-To / References, the one list order, the search filter |
| `cue.ts` | the cue's state and the unread `Poller` (90 s, only while the page is visible) |
| `contacts.ts` | To/Cc suggestions merged from what the window passes in (and contact tiles, if a reader exists) |
| `mail-to-hive.ts` | "Save to hive": one tile, through the hive's own write paths |
| `template.ts` | templates: the format, strict reader, fill checking, rendering (built; not wired — section 4) |
| `index.ts` | generated by `prepare`; do not edit |

**To add a pane or a function:** write it as a pure atom (bytes or values in, values out; no DOM unless it is the
window, no storage, no key), give it a spec, and wire it in `mail.view.ts`. A new file must not register
anything, and must not be a second `*.queen.ts`, `*.drone.ts`, `*.view.ts` or `*.bee.ts` in the folder. Every
string goes through `t('mail.<key>', fallback)`. Add the key to `en.json` and `ja.json` (`hypercomb-shared/i18n/`).

**The ratchets that will catch you** (`doctrine.spec.ts`, run from `src/` with `npx vitest run doctrine.spec.ts`):
- *one behaviour per feature, no self-registration* — `mail` is listed in `hypercomb-essentials/atomized-roots.json`,
  the one list the spec and `scripts/build-module.ts` both read; a second bee, or a module-scope registration in a
  dependency, fails it;
- *no raw storage writes* — frozen per file in `doctrine.storage-writes.json`; durable state goes through the
  store; the mail files have no entry and must not gain one;
- *no third-party loads* — a standing rule (`no-third-party-requests.md`, T7); nothing in `src/mail/` may load from
  a host we do not control (I did not verify that a single named ratchet checks this for `src/mail/`);
- *the shape ladder* — `border-radius` stays on `hypercomb-shared/ui/_shape.scss`'s ladder (controls 2px, cards
  3px, floating 4px); the window uses the control size.

Also, never add an `<hc-*>` tag to an `app.html` (B5, `shell-surfaces.md`): the window's surface is registered by
tag.

### 2d. Another client — the wire contract (v2)

This is `worker.js` as implemented. A phone app or a native client implements exactly this.

**Auth, every route.** `Authorization: Nostr <base64 of a signed event>`: kind 27235, tags `u` = the exact URL
(query included), `method`, and for a body `payload` = sha256 hex of the exact body bytes. Created within ±60 s
of the Worker's clock. "The owner" of an address is any key in its `MAIL_CONFIG.keys` entry.

- **Every write (POST, PUT, DELETE) is single-use.** The Worker records the event id; the same signed request a
  second time answers **409** `this signed request was already used` and does nothing. **Put a random
  `["nonce", <random>]` tag in every write event**, or two identical writes in one second share an event id and
  the second is refused. A 409 on a retried send means it already went: refresh Sent, do not resend. GET is not
  spent. If the record cannot be written, the answer is 503 (it fails closed).
- **Refusals before the signer is known to own the address are all `401 not authorized`**, for real and ghost
  addresses alike, so a stranger learns nothing. An owner key gets the precise text. Do not key a UI on 401 text.
- **Roles:** a key without the act gets **403** `this key may not <read|mark|draft|delete|send>`.

| route | who | answer |
|---|---|---|
| `GET /mail/me` | any valid signature | `{ addresses: [..], names: { address: name }, can: { address: [acts] } }`, only the signer's own |
| `GET /mail/{box,sent,drafts}/<address>?limit=&cursor=` | `read` | `{ items, cursor }`; `limit` 1–500, default 100; `cursor` null at the end |
| `GET /mail/{box,sent,drafts}/<address>/<sig>` | `read` | the sealed envelope bytes (`application/octet-stream`); 404 if absent |
| `PUT /mail/{box,sent}/<address>/<sig>/marks` | `mark` | body `{ read?, hidden?, flagged?, deletable? }`, booleans only (else 422); answers the merged marks; 404 if absent |
| `DELETE /mail/{box,sent,drafts}/<address>/<sig>` | `delete` | 204 only when `hidden` and `deletable` are both true (drafts: always); else 409 `hide it and mark it deletable first`; 404 if absent |
| `PUT /mail/drafts/<address>` | `draft` | body = any JSON object; answers `{ sig }` (the sha256 of the exact body) |
| `POST /mail/send` | `send`, owner of `from` | `{ messageId, sig }` (`sig` null if the Sent copy could not be filed) |

`<address>` is URL-encoded and lowercased. Other answers: 405 with a plain reason for a wrong method, 404 for an
unknown path, 422 `bad address`. Every answer carries `Cache-Control: no-store` and `X-Content-Type-Options:
nosniff`; CORS answers only the origins in `ALLOWED_ORIGINS`, with `GET, POST, PUT, DELETE, OPTIONS`.

**List item:** `{ sig, at, v, meta, wraps?, marks }`. `at` is the arrival time in ms; `v` is 1 or 2; `meta` is a
sealed string; `wraps` (v2 only) is a parsed array `[{ to, epk, wk }]`; `marks` is an object or `null` (always
`null` for drafts). Items are in the bucket's key order (by sig), **not by time**: sort by `at` yourself.

**Marks** are stored plain (they say read/hidden/flagged, not what the mail says), merged over what was there,
stamped with `at`; the body is at most 1 KiB.

**Delete** moves the envelope and its marks to `trash/` (marks with `{ deletedAt, by: <signer key> }`); if the
trash copy fails nothing is removed (503). **Say "the host keeps it 30 days", not "permanently".** At most
`MAX_DELETE_PER_DAY` (200) per address per UTC day, then **429** `daily delete limit reached`.

**Send body** (JSON, at most **10 MiB**): `{ from, to[], cc?[], bcc?[], subject, text?, html?, replyTo?,
inReplyTo?, references?, attachments?: [{ filename, type, content: <base64> }] }`. `text` and/or `html` is
required. Subject non-empty, no line breaks, at most 998 characters; at most **20** recipients in all; `inReplyTo`
and `references` are `<message-id>` forms; at most **10 attachments**, **6 MiB decoded in all**; `type` is
`type/subtype` with no parameters; `content` strict base64; filenames lose control and bidi characters and
`/ \ :`. `from` goes out as `{ email, name }` when `names[from]` exists. The order of checks: signature, body
(415/413/400), signer owns `from` (else 401), payload tag matches (401), `send` capability (403), the event is
spent (409), then validation (422, or 413 `attachments too large`), then the day's cap (**429** `daily send limit
reached`, `MAX_SEND_PER_DAY`, default 100; the counter fails closed with 503). Cloudflare's refusals pass on only
their code: 429 for limits, 422 for a refused sender, recipient, header or attachment, 502 otherwise, and nothing
is filed as sent. Threading headers are dropped, not the mail, if Cloudflare will not carry them. The sealed Sent
copy keeps the attachments.

**The envelope, v2** (`seal.js` writes it; `envelope.ts` opens it; `envelope.spec.ts` opens the Worker's own
output, so the two cannot drift):

```
envelope   = [4-byte big-endian header length][header JSON][ciphertext]
header     = { v: 2, sig, iv, wraps: [ { to, epk, wk }, … ] }
ciphertext = AES-256-GCM(plain, K, iv, additionalData = sig)      K = a fresh 32-byte key per message
wrap       = a fresh ephemeral key pair per recipient:  wk = nip44.encrypt(base64(K), conversationKey(ephemeral, to))
```

Open it by finding the wrap whose `to` is your public key (otherwise try each, at most 3), decrypting `wk` to get
K, decrypting the body, and checking that sha256 of the plaintext equals `sig` and that `header.sig` is the sig
you asked for. The object's `customMetadata` is `{ at, v: "2", wraps: <JSON of the wraps>, meta }`, with `meta` =
`base64(iv2) + "." + base64(AES-256-GCM(JSON meta, K, iv2, additionalData))`, so a list opens without fetching
bodies. **The meta's additional data is `"meta:" + sig`**; try that first, then the bare `"meta"` (objects sealed
before the binding). **Envelope v1** (`header.v === 1`: one `epk`/`wk`; `meta` = `"<epk>.<nip44 ciphertext>"`) stays
readable for ever. The meta JSON stays under a 720-byte budget (R2 allows 2 KB of metadata and three wraps use
most of it); when it is too long the Worker drops the preview, then the oldest references, the date, and so on.
Sealed `meta` fields: `{ from, to, subject, size, at, messageId?, inReplyTo?, references? (last 3), date?,
hasAttachments, preview? (120 characters of the first text part) }`; Sent adds `id`; drafts hold `{ to, subject,
size, at }`. Subjects are raw (RFC 2047 words left for the reader to decode).

**Other limits:** a stored message is at most 10 MiB (`MAX_STORE_BYTES`); a draft at most 1 MiB; marks 1 KiB;
the Worker never parses a received message past 64 KB for its meta.

## 3. The window, as it is

Built against jsdom specs (60 for the window, 410 for `src/mail` at the last note); **never run in a live hive**,
because the building session was not authorised to start a server or build.

**The cue.** jwize's one named bug was *"the info shows up late, so we need some cue."* Every act writes to a
status line under the header (`role=status`, with a thin bar) in the same frame as the press. Three placeholder
rows show from the first frame, and once the page size is known one per row; each row replaces a placeholder as
its metadata opens, already in its final place, and the bar reads "N of M". Opening a message shows its subject,
from, to and date at once with skeleton lines, then the body. Refresh, Older, Send, Save draft, Discard, Hide,
Un-hide, Flag, "may be deleted", Delete and Save to hive are each busy, disabled and worded while they run, and
their result is said in words. A background poll is quiet ("Checking for mail…") and never covers something you
pressed.

**Tabs and search.** Inbox, Sent, Drafts, Hidden. Hidden lists rows marked hidden from the box and Sent, shaded,
and only looks through the pages opened so far (the window says so). Search is client-side, over the opened
from, to, subject and preview; every word must match; Escape clears it before it closes the window. The Drafts
tab is absent for a key that may not draft.

**Threads.** Messages join by Message-ID, In-Reply-To and References into conversations, newest first,
collapsed, with a count; a press expands, members are indented and each opens on its own. A thread groups within
one folder, not across Inbox and Sent. There is no "hide all" on a collapsed thread; hide per message.

**Marks and hide-first.** Opening a message marks it read. Flag toggles (★ on the row). Hide is on each row and in
the message. **Delete** appears only inside Hidden, stays disabled until that message's "may be deleted" box is
ticked, and only then calls the host: two acts, never one, and its words say the host keeps the message 30 days.
Roles hide what the key may not do: a `['read']` key sees a plain reader (no Write, no Drafts tab, no row acts,
nothing marked on open); a refusal that arrives anyway is worded by its act. A replayed send says "This message
was already sent; it is in Sent" and offers no retry.

**Attachments and the sandboxed frame.** Attachments are listed as name · type · size, and nothing opens until
**Download**: the bytes are made into a Blob typed `application/octet-stream` (a stranger's `text/html` must
download, never render in the hive's origin). HTML bodies are made inert (`mail-html.ts`) and shown in an iframe
with `sandbox="allow-popups allow-popups-to-escape-sandbox"` and a CSP of `default-src 'none'` that also forbids
`base` and form submits, where only `data:` images load. Remote images, backgrounds and stylesheets are never
fetched, and the window says how many were held back. PNG/JPEG/GIF/WebP attachments (2 MiB each, 8 MiB in all) are
previewed in a second frame under the same rules.

**Compose and drafts.** Write, Reply, Reply all, Forward (a forward carries the original's attachments). A
Formatting checkbox turns on the light marks with a live preview in the same script-less frame; Send carries the
`html` and the `text`. An attach picker shows the caps (10 files, 6 MB in all) and refuses an over-cap file at
pick time. To/Cc suggest from the inbox senders, Sent recipients and the open message through a `<datalist>`
(it completes a whole field, not the second address in a list); a From selector appears with several mailboxes.
Drafts autosave after a 2 s pause and on leaving, are named by their bytes (an edit replaces the previous draft),
reopen from the Drafts tab, and are removed when sent. A draft over 1 MiB is saved without its files and the
window says so.

**Save to hive, and what it does with your privacy.** On a received message, **Save to hive** makes ONE tile where
you stand when you press: named by the subject, its note the text, the raw message a resource at its own
signature, each attachment a resource plus a `files:attachment` record, and last a `mail:message` mark
`{ sig, content, from, subject, date, messageId }`. Pressing twice on a page places nothing the second time. The
sentence beside the button: *Saving puts this message's text, its raw bytes and its attachments into the hive
unsealed, so whatever you share from that page carries the message with it.*

**The unread cue.** A bounded poll (every 90 s, only while the page is visible, never overlapping itself, stopped
after two failures in a row) lists every mailbox's inbox while the window is closed, emits `mail:unread { count }`
and sets a header pill, `indicator:set { key: 'mail:unread', icon: 'mail', label: '{count} unread' }`. Only a
press on that pill (`indicator:activate`) opens the window; arrival never does. The poll starts only after the
window has been opened once in the page's life and found a mailbox, and never behind a NIP-07 extension (a
prompt every 90 s would be the window opening itself by another name).

**Keyboard.** `j` and `k` move between rows, Enter opens the focused row, Escape steps back (compose to where it
came from, saving first; a message to the list; then clears a search; then closes). Names are shown with
addresses ("Jaime <jaime@hypercomb.com>"); encoded subjects and senders are decoded for display.

## 4. Templates

A template is an artifact — one signature, a schema of typed holes (`text`, `url`, `number`, `date`, `resource`,
`list`) and a plain and an html body — and a message that uses one carries only `{ template: <sig>, fill }` in a
MIME part of its own beside the baked text and html, so any outside reader still gets a complete email.
**Built:** `template.ts` (the format, strict reader, fill checking, rendering, the message part; 136 specs).
**Designed, not built:** the send path carrying the part, the reader rendering the live version, the
`mail:template` pool and its trust gates, the composer's "save as template", and scripts (a declared script is
always `not-run`). Nothing is wired into the window and nothing runs a script anywhere. Read
`mail-templates.md`; its decisions are jwize's.

## 5. Privacy — exactly what is seen, and for how long

- **In transit and while the Worker runs, everything is plain at Cloudflare.** A message is in the clear in
  `email()` while it is sealed, and in `send()` while it goes out; that is inherent to receiving and sending mail
  at all. The Worker logs no content and no keys, only error messages and address names.
- **Stored copies are sealed.** The bucket holds ciphertext; only a listed key opens it. The server sees *when*
  (`at`), the sealed sizes, the marks (stored plain: read, hidden, flagged, deletable), the folder and address
  names, and which signer key signed which request.
- **Cloudflare's Email preview** keeps the bodies of sent messages readable in the Activity log for about 7
  days and is on by default; its metadata and metrics are kept about 31 days. *These durations come from the
  plan and the brief, not from a check of Cloudflare's current documentation.* Turning Email preview off is
  jwize's act (section 8).
- **The Gmail copy** (`copyTo`) is plain at Google, for as long as the person keeps it. It is the safety net
  against a lost key and the cost is that copy.
- **A message saved to the hive is unsealed there** (section 3).
- **The mail host sees your public key** on every signed request, including the poll.
- **A leaked device key today** can do everything its `can` allows. A key listed as a plain `"<hex>"` may read,
  hide, mark deletable, delete (into a trash the operator purges after 30 days), draft and send as the address.
  R1 #6 named this; the fix in the Worker is the roles (`can`) and the trash, plus caps of 100 sends and 200
  deletes a day per address. **Until the operator gives each key only the acts it needs, a plain key has all
  of them.** The recovery key should be read-only.
- **Replays:** an eavesdropper who copies a signed write cannot use it twice; a signed GET can be replayed for the
  60-second window and re-reads the sealed mailbox (ciphertext).

## 6. Leanne's steps

Her key is in the public ledger as `83814be5…` (`directory.hypercomb.com/publications.json`), from the plan. A key
taken from a ledger is the publisher key, **not necessarily the device key** — jwize's own was confirmed in his
window before his routing rule was switched, because mail sealed to the wrong key can never be opened. So:

1. She opens the published client on her own hive (the client is **not yet published**; it needs jwize's
   `npm run publish:revision`), types `mail`, and copies the key the window shows.
2. The host operator checks it against `83814be5…` and adds it to `MAIL_CONFIG.keys` for her address (and a
   `names` entry; and the recovery key, read-only, if she keeps one).
3. Her copy address is **unverified**: it must be verified in Email Routing before it is listed in `copyTo`.
4. Only then is the Email Routing rule for `leanne@hypercomb.com` set to **Send to a Worker** → `hypercomb-mail`
   (`inbound-mail.md`: `leanne@` has no rule yet).

Mail sealed before her key is listed cannot be opened by her, so steps 1–2 come first.

## 7. Limits and known gaps

- **Not deployed, not published.** The Worker on `hypercomb.com` is the 2026-11-05 version: it has `/mail/me`,
  list, open and send, with envelope v1 and no marks, drafts, delete, roles or attachments. The new client
  against it will find those routes missing. Deploying the new Worker (it carries the live `jaime@` mail) and
  publishing the essentials revision are jwize's two acts.
- **The window was never run in a live hive**; the specs drive the real Worker code with an in-memory bucket.
- **The R1 security pass:** its 15 findings were fixed in the Worker and the browser side and pinned by tests,
  except two left as decided: **#13** (a storage outage with no copy address still bounces permanently, because
  Cloudflare's documentation does not say a thrown handler is retried) and **#15** (`http://localhost:4250` stays
  in `ALLOWED_ORIGINS`, the replay fix removing the harm). **#14** (memory at the largest sizes) is lowered caps
  and unmeasured: nobody has run the maximum receive and send under `wrangler dev`. Browser-only behaviour behind
  #1 (preconnect and dns-prefetch against a CSP; meta refresh in a sandbox in Firefox and Safari) was not tested in
  a real browser. R1 did not cover `mail-to-hive.ts`, and the window frame code outside `mail-html.ts` was only
  reviewed as far as the note says.
- **The three gaps in the hive side:** (1) there is no sanctioned "make a tile AT these segments" for a module, so
  Save to hive goes through the command line's one create path, which may land the tile elsewhere (at a doorway or
  in a holder's group) without saying; (2) no hive-wide answer to "has this message been saved anywhere" — only per
  page; it is derivable, so a derived cache keyed by signature, minted only in the optimize phase; (3) no reader of
  contact tiles exists hive-wide, so To/Cc suggestions come from the window's own mail only.
- **Message size.** A received message is stored up to 10 MiB, a send body up to 10 MiB with 6 MiB of attachments,
  at most 10 attachments and 20 recipients, a draft 1 MiB. Cloudflare Email Routing itself takes up to 25 MiB; a
  larger message is copied or bounced.
- **No IMAP/SMTP.** A standard mail app (Outlook, Thunderbird) cannot read it; that needs a different kind of server.
- **No spam filter, no calendar invites, no end-to-end encryption to recipients elsewhere, no WYSIWYG editor.**
- **The phone layout is set aside** (jwize, 2026-10-24).
- **Losing every owner key loses the mail**; the server cannot open it.
- **Delete is a 30-day trash only once the lifecycle rule exists**; there is no restore route.
- **Hidden** looks only through opened pages; **the closed-window poll** opens a whole first page of metadata
  through the signer just to count unread (a marks-only list would avoid that).
- **i18n:** the `mail.*` keys are not yet in `en.json` or `ja.json` (the window carries its English fallbacks);
  the i18n session is adding them.
- **Pending from the templates note:** whether Cloudflare's send binding takes a content id (for baked inline
  pictures) is unchecked.

## 8. Decisions that wait for jwize

1. Turn Cloudflare's **Email preview** off (sent bodies readable in the Activity log for about 7 days).
2. **Deploy the Worker** (the live `jaime@` mail) and **publish the essentials revision**.
3. **Roles (R1 #6):** whether each owner key gets only the acts it needs; whether the recovery key is
   `can: ["read"]`; and where each owner generates and keeps one.
4. **Leanne:** her key (`83814be5…`), her copy address, her first login.
5. **Where "Save to hive" places a message:** the current tile (as built), or a `mail` tile.
6. **Should the queen start the unread poll at boot** (every hive without a mailbox would then send a signed
   request carrying its public key to the mail host on every boot), or only after the window has been opened once?
7. **The trash lifecycle:** set the 30-day purge rule on the live bucket.
8. **Templates** (the hole types, where templates are authored, the first trusted publisher set, whether a template
   may carry a script at all): `mail-templates.md` lists them.
9. **A rail mail icon** with an unread state (the chat pattern) is a shell edit outside the mail files; the header
   pill is what exists.
