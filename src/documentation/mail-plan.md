# Mail — the plan for a fully featured, hive-native email

**Status:** written 2026-11-06, after the first commit landed what works (`documentation/inbound-mail.md` is
the record of that: the Worker on `hypercomb.com/mail/*`, the `mail` window, the live jaime@ rule). This plan
is the next round. jwize's brief: *"it works, then we improve the experience, make the email fully featured
… remember each tile is a building block in the hive … we are building a scaffold for everyone to join in
on"*, and the one named bug: *"the info shows up late, so we need some cue to see that is happening."*

## 1. What it must keep (the doctrine this feature answers to)

- **A message is an artifact.** Its signature is the sha256 of its raw bytes — the same signature in the
  mailbox and, once saved, in the hive. Same bytes, one signature, stored once (I1, A6).
- **Tiles are the building blocks.** A saved message is a tile that carries its own text and its own
  attachments as resources; a contact is a tile; a mailbox is something a tile can open as. Relations are
  marks the members wear, never a parent that holds them (A1–A4). Nothing is minted the participant did not
  ask for: "Save to hive" is a press.
- **Nothing contacts a host we do not control.** Reading mail never fetches a remote image, stylesheet or
  tracker; the window says how many it held back (T7). Only the mail host(s) are spoken to.
- **Hide first, delete second.** A list offers hide; hidden things collect in a hidden area; delete is refused
  unless hidden and marked deletable, and delete means local forget (H4).
- **Pools carry colons.** `mail:<address>`, `mail-sent:<address>`, `mail-draft:<address>`, `mail:message`.
  Addresses are derived (sha256 of the meaning), never hardcoded hex (P1, P2, P4).
- **The key never leaves the device.** Signing and the one decryption step go through the hive's
  `NostrSigner`; opening mail never mints a key; no file in `src/mail/` reads, stores or exports a key.
- **One behaviour per feature.** `mail.queen.ts` is the domain's one bee; every other file in `src/mail/` is a
  dependency that exports and never registers (`atomized-roots.json` lists `mail`; the ratchets check this).
- **Who lives on a host is a secret, not code.** `MAIL_CONFIG` (keys, copyTo, names) is set per deployment
  and survives deploys; the repository is public.
- **Text through i18n keys**, `#private` fields, EventTarget + `change`, ESM with `.js` imports (B5, B6).

## 2. The scaffold — how everyone joins in

| who | what they do | what they need |
|---|---|---|
| **a host** (any zone on Cloudflare) | deploys `hypercomb-relay/mail-worker` on `<zone>/mail/*`, sets `MAIL_CONFIG`, points Email Routing rules at it, onboards Email Sending | the docs' go-live steps; nothing from hypercomb.com |
| **a participant** | opens `mail` in their hive; the window shows their public key; the host's operator adds it to an address | their own hive, nothing else |
| **a developer** | adds a pane or a function as one atom in `src/mail/` (a pure module with a spec) and wires it in the window | this plan's file map; the wire contract below |
| **another client** (a phone, a native app) | speaks the same wire contract | section 3 |

The client talks to **any mail host** and names none in code: it asks the hosts the participant carries (the
Home Domain, then Your Network — `mail-hosts.ts`), an address of its own domain first when that domain is one of
them, and nobody at all when the hive carries no host (`no-hosts`, with the door to Your Network).

## 3. The wire contract (v2) — the Worker and the client implement this exactly

Every request is NIP-98 signed (`Authorization: Nostr <base64 event>`, kind 27235, tags `u` = exact URL,
`method`, and for a body `payload` = sha256 hex of the exact bytes). "The owner" = any key listed for that
address in `MAIL_CONFIG.keys` (a string, or an array of hex keys; every listed key reads and sends).

| route | who | answer |
|---|---|---|
| `GET /mail/me` | any valid signature | `{ addresses: [..], names: { address: name } }` — only the signer's own |
| `GET /mail/{box,sent,drafts}/<address>?limit=&cursor=` | owner | `{ items: [{ sig, at, v, meta, wraps?, marks? }], cursor }` |
| `GET /mail/{box,sent,drafts}/<address>/<sig>` | owner | the sealed envelope bytes |
| `PUT /mail/{box,sent}/<address>/<sig>/marks` body `{ read?, hidden?, flagged?, deletable? }` | owner | merged marks; stored PLAIN at `marks/<pool>/<sig>` (not mail content; the server may read them) |
| `DELETE /mail/{box,sent,drafts}/<address>/<sig>` | owner | 204 only when `marks.hidden && marks.deletable` (drafts: always); else 409 |
| `PUT /mail/drafts/<address>` body = the draft JSON | owner | `{ sig }` (the Worker seals it like a sent copy, pool `mail-draft:<address>`) |
| `POST /mail/send` body JSON | owner of `from` | `{ messageId, sig }` |

`POST /mail/send` body: `{ from, to[], cc?[], bcc?[], subject, text, html?, inReplyTo?, references?,
attachments?: [{ filename, type, content: <base64> }] }`. Caps: body 16 MiB, ≤ 10 attachments, ≤ 10 MiB
decoded in all, ≤ 20 recipients; `from` is sent as `{ email, name }` when `names[from]` exists. The sealed Sent
copy keeps the attachments.

**The envelope, v2** (`mail-worker/seal.js` writes it; `src/mail/envelope.ts` opens it; `envelope.spec.ts`
opens the Worker's own output, so the two cannot drift):

```
envelope   = [4-byte big-endian header length][header JSON][ciphertext]
header     = { v: 2, sig, iv, wraps: [ { to, epk, wk }, … ] }
ciphertext = AES-256-GCM(plain, K, iv, additionalData = sig)       K = fresh 32-byte key per message
wrap       = a fresh ephemeral key pair per recipient:  wk = nip44.encrypt(base64(K), conversationKey(ephemeral, to))
```

Object `customMetadata` = `{ at, v: "2", wraps: JSON of the same wraps, meta: base64(iv2) + "." +
base64(AES-256-GCM(JSON meta, K, iv2, additionalData = "meta")) }`, so a list opens without fetching bodies.
At most **3 keys per address** (R2's 2 KB metadata). **v1 objects** (`header.v === 1`, one `epk`/`wk`,
`customMetadata.meta = "<epk>.<nip44 ciphertext>"`) stay readable forever (H3).

Sealed `meta` fields: `{ from, to, subject, size, at, id?, messageId?, inReplyTo?, references? (last 3),
date?, hasAttachments?, preview? (first 120 chars of the text part) }`.

## 4. The file map — who owns what (parallel agents never share a file)

| owner | files | may read |
|---|---|---|
| **W** the Worker | `hypercomb-relay/mail-worker/{seal,worker,nip98}.js`, `wrangler.toml`, `hypercomb-relay/mail-test-helpers.js`, `hypercomb-relay/mail-*.test.js`, `hypercomb-relay/mail-address.js` | everything |
| **C2** message content | `src/mail/mime.ts`, `mail-html.ts`, **`format.ts` (new)**, `reply.ts` + their specs | everything |
| **H** the hive side | **`src/mail/contacts.ts`, `src/mail/mail-to-hive.ts` (new)** + specs | everything; writes nothing outside |
| **C1** transport | `src/mail/envelope.ts`, `src/mail/mail.service.ts` + specs | W's finished Worker |
| **C3** the window | `src/mail/mail.view.ts`, `mail.view.spec.ts`, `mail.queen.ts`, **`src/mail/cue.ts` (new, if wanted)** | all of the above |
| **E** i18n | `hypercomb-shared/i18n/en.json`, `ja.json` (`mail.*` keys only) | C3's strings |
| **D** docs | `documentation/mail.md` (new), `documentation/inbound-mail.md` | everything |

Nobody touches `src/side-effects.ts` (generated), nothing outside these paths, and no new `*.drone.ts`,
`*.queen.ts`, `*.view.ts` or `*.bee.ts` in `src/mail/` (a second behaviour). `src/mail/*` must never
self-register; the queen registers. The shared checkout holds other sessions' uncommitted edits: those files
are off limits to every agent.

## 5. The waves

1. **Wave 1, in parallel:** W, C2, H.
2. **Wave 2:** C1, against W's finished Worker (its spec drives the real Worker code with an in-memory bucket).
3. **Wave 3:** C3, wiring C1, C2 and H into the window.
4. **Wave 4, in parallel:** E (i18n), D (docs), R (adversarial security review), V (full verification:
   relay tests, mail specs, `doctrine.spec.ts`, `tsc` for `src/mail/`, the Worker bundle).
5. Then, in this session: fixes from R and V, the commit, and two acts that wait for jwize: deploying the
   Worker (it carries the live jaime@ mail) and publishing the essentials revision.

## 6. The features, by owner, with what "done" looks like

**W — the Worker**
1. Envelope v2 with N keys; v1 still opens; `MAIL_CONFIG.keys[address]` accepts a string or an array.
2. Meta enrichment at receive: Message-ID, In-Reply-To, References (last 3), Date, hasAttachments, a 120-char
   preview of the text part (cheap: first `text/plain` part, QP/base64 decoded, first 4 KB).
3. Marks: `PUT …/marks` (merge), returned inline by the list; `DELETE` per H4; 409 otherwise.
4. Drafts: `PUT /mail/drafts/<address>` seals like a sent copy; list/get/delete.
5. Attachments on send (caps above), passed to Email Sending, kept in the sealed Sent copy.
6. Names: `MAIL_CONFIG.names` → `from: { email, name }`; `/mail/me` returns `names`.
7. Tests for all of it (`node --test`), the FakeR2 grows `delete`; `wrangler deploy --dry-run` bundles; no
   Node builtins in the bundle. **Never deploys.**

**C2 — message content**
1. `mime.ts`: attachments carry their bytes on demand (`attachmentBytes(raw, index)` or an accessor), inline
   images as now, a `previewText(mail)`; the memory caps stay.
2. `format.ts` (new): light marks → `{ html, text }`: paragraphs by blank line, `**bold**`, `_italic_`,
   `` `code` ``, `- ` and `1. ` lists, `> ` quotes, `# ` headings, `[text](https://…)` and bare URLs.
   Everything escaped; `href` only `http(s):`/`mailto:`; the html is for the sandboxed frame and for
   `POST /mail/send`'s `html`; the text always goes alongside.
3. `reply.ts`: `forwardDraft(mail)` carrying the attachment list; `replyDraft` as is.
4. `mail-html.ts`: unchanged rules; expose what was blocked by kind.

**H — the hive side** (research first: `src/link/`, `src/editor/image-drop.drone.ts`, `src/notes/`,
`src/contact/`, `documentation/website-artifact-paradigm.md`, `hypergraph-molecule-lineage.md`,
`known-location-pools.md`; then build, using only existing services through IoC and the store's
sanctioned writes — never raw storage, never a new typed folder)
1. `contacts.ts`: `knownAddresses(extra)` → `[{ address, name?, source }]` from the hive's contact tiles
   (vCards) if a service exists, merged with addresses the window passes in (Sent, inbox). No network, no
   storage.
2. `mail-to-hive.ts`: `saveMessageToHive({ mail, raw, sig })` makes ONE tile where the participant is
   (name = subject, its note = the text, the raw message as a resource at its own `sig`, each attachment as
   a resource), wearing the mark `mail:message` with `{ sig, from, date }`. The press is the yes; nothing
   else is minted. If a needed write path does not exist, STOP and document the gap in the module header
   rather than inventing one.
3. Specs with the services mocked.

**C1 — transport**
1. `envelope.ts` opens v1 and v2 (finds its wrap by the signer's public key; falls back to trying each).
2. `mail.service.ts`: every route in section 3; `list(address, folder, cursor, onItem?)` reports rows as
   their metadata opens (progressive); `addresses()` across hosts (address domain first, then the default
   host); `MailError` gains `conflict` (409); names; drafts; marks; delete; attachments in `send`.
3. Specs drive the REAL Worker code with the in-memory bucket (as today).

**C3 — the window** (the named bug comes first)
1. **A cue within 100 ms of every act:** skeleton rows while a list loads; rows appear one by one as metadata
   opens; a busy state on Refresh, Open, Send, Save, Hide (the button says what it is doing and is disabled);
   "Checking for mail…" on a poll; never a blank pane.
2. Tabs: Inbox, Sent, Drafts, Hidden. Search (client-side over opened metadata). Threads: group by
   References/In-Reply-To, collapsed, newest first.
3. Read/unread (opened = read), flag, hide (H4), delete only from Hidden and only when the participant marked
   it deletable there.
4. Attachments: listed → download (blob URL + `<a download>`), images shown inside the sandboxed frame as
   data URLs; never a remote fetch.
5. Compose: formatting toggle with a preview (`format.ts`), attachment picker (caps shown), drafts autosave
   (2 s debounce + on close), reply, reply all, forward; To/Cc suggestions from `contacts.ts` + Sent.
6. "Save to hive" on a message (`mail-to-hive.ts`), with the result said in words.
7. Unread cue: a bounded poll while the hive is open; a `mail:unread` effect and an icon state through the
   icon registry if that pattern exists (see `portal-carry.drone.ts`); **never opens the window** on arrival.
8. Keyboard: j/k, Enter, Escape steps back then closes (as now). Names shown for addresses.
9. Every string through `t('mail.<key>', fallback)`; specs for each behaviour.

**E — i18n:** every `mail.*` key used in `src/mail/*.ts` added to `en.json` and `ja.json` (real Japanese),
catalogs kept consistent; the catalog specs pass.

**D — docs:** `documentation/mail.md` — the scaffold (host, participant, developer, another client), the wire
contract, the envelope, limits, privacy (what Cloudflare sees and for how long), Leanne's steps; and
`inbound-mail.md` refreshed to point at it.

**R — security review (adversarial):** auth on every route, replay, crypto misuse in v2, XSS in `format.ts`
and `mail-html.ts`, anything that could contact a third party, DoS through sizes and counts, marks and delete
abuse, the key never leaving the signer. Findings with `file:line`; fixes are made here afterwards.

**V — verification:** `node --test` in `hypercomb-relay`, `npx vitest run hypercomb-essentials/src/mail`,
`npx vitest run doctrine.spec.ts`, `npx tsc -p hypercomb-essentials --noEmit` (errors in `src/mail/` only
count), the Worker and queen bundles; a pass/fail table.

## 7. Out of scope this round (so nobody builds it)

IMAP/SMTP for Outlook or Thunderbird; spam filtering; calendar invites; end-to-end encryption to recipients
elsewhere (PGP); a WYSIWYG editor; the phone layout (set aside); publishing the essentials revision and
deploying the Worker (jwize's acts).

## 8. Templates — pools of meaning you fill in (jwize, 2026-11-06)

jwize, while wave 2 ran: *"there should be pools of meaning which are templates, and they can be audited and
fill in the blanks with variables. This opens up incredibly expressive emails. Trust the community and trust
the resources, so you are able to have even animated scripts in emails."*

**How it fits the doctrine, step by step**

- **A template is an artifact.** Its bytes have one signature (I1). It declares its holes — a layout: names
  arranged, a schema of holes (N4). Audited once, by signature: whoever holds the bytes checks them, and every
  message that names that signature names exactly those bytes (M1). No re-auditing per message.
- **Templates live in a pool of meaning, `mail:template`** (P1, P4), federated like every pool: the local
  directory is one replica, the same word is the same address on every host; a hive learns templates by
  replicating them from hosts it follows (T1), never from a sender's server (T7). A template is also a tile —
  made by breaking a message apart (A1): the composer's "save as template" is that press.
- **A message is a reference plus a fill.** `{ template: <sig>, fill: { hole: value } }` — small, and the
  reader renders it from its own replica of the template. For the outside world the sender bakes the static
  renderings at send (the `text` and `html` Cloudflare delivers), and carries the reference in the message
  itself as a MIME part `application/vnd.hypercomb.mail+json` (and an `X-Hypercomb-Template` header), so
  Gmail shows the baked page while a Hypercomb reader renders the trusted, live version.
- **Holes are typed, and the fill is checked before anything renders:** `text` (escaped), `url` (http/https/
  mailto only), `number`, `date`, `resource` (a signature the reader resolves from its own heap — an image
  shows only if the bytes are held; nothing is fetched), and lists of these. Unknown holes are refused;
  missing required holes refuse the send.
- **Trust is the three gates, never conflated (T5):** selection (whose templates I take — the hosts I follow),
  intake (which I keep, by marks), activation (which may EXECUTE). A template's script runs only when its
  bytes are signed by a followed publisher and admitted by the activation gate — exactly as a bee is (T2,
  T3); then it renders as a hive view with a bee view's powers (no network beyond our hosts: T7). An unknown
  or unadmitted template renders only its baked html in the script-less sandboxed frame; its script never
  runs. Offers arrive the way module offers do (`/offers`): the yes is a press.
- **"Animated scripts"** = a script slot in an admitted template, run in the hive's view sandbox. The same
  message, read by someone who has not admitted the template, is still a complete, readable email.

**Build order (a wave of its own, after the window):**
1. `src/mail/template.ts` (pure): the template format, schema and fill validation, rendering to `text` +
   `html` with per-type escaping, the trust predicate injected — no execution in this step; specs with
   hostile fills.
2. Send carries the part and the header; the Worker passes them through untouched.
3. The reader detects the part, resolves the template from the local heap by signature, renders the live
   version when held and admitted, the baked html otherwise.
4. Activation and the script view — after the gates are wired to the pool (the biggest step; design first).

**Decisions for jwize:** the hole type set; where a template is authored (the composer's "save as template",
a `/template` word, a tile broken apart); the first trusted publisher set; whether outside recipients get
the baked html or text only; whether a template may carry a script at all in the first release.

## 9. Decisions that wait for jwize

- Turn Cloudflare's **Email preview** off (sent bodies readable in the Activity log for ~7 days).
- **Leanne:** her key (`83814be5…` in the public ledger), her copy address (still unverified), her first login.
- **A recovery key** per address (a second key in `keys`, kept offline by the owner) — the v2 envelope makes
  it possible; whether and how each owner generates one is theirs.
- Where "Save to hive" places a message: the current tile (the plan), or a `mail` tile.
- **The next envelope version (R2 #10):** the signer opens any NIP-44 payload a host hands it as a wrap or v1 meta; nothing leaks today (K must be 32 bytes, meta must be JSON and is only shown), but the domains should be separated — the Worker wraps `"hc-mail-k:" + base64(K)` and the client refuses any plaintext without that label, with v1 meta accepted only for objects older than a cutoff. Deferred: a format change, taken with the next version, not now.

## 10. Granted addresses — a host makes mail available from the hive (2026-11-08)

jwize: *"Mail shouldn't be hardcoded to my address. Instead you should be able make that available."* Two halves.
The client names no host (`mail-hosts.ts`: the Home Domain, then Your Network; `no-hosts` with the door to Your
Network when the hive carries none). And the host's people no longer need the secret: an admin key named once in
`ADMIN_KEYS` grants, changes and revokes addresses over signed routes (`GET /mail/grants`, `PUT` and `DELETE
/mail/grants/<address>`), the grants kept in the bucket at `grants/<address>`, and the desk's Host pane is where
that is done. A grant is the address's whole record and wins over the secret while it exists; nothing already
received is touched. The contract, the shapes and the refusals: `mail.md` §2a, §2d, §3 and §5.

Next, not built: an INVITATION — a link the operator sends that lets a newcomer claim an address with their own key,
so the operator never handles a key at all.
