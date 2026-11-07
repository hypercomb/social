# Mail templates: pools of meaning you fill in

**Status, 2026-11-07.** Every section heading says **built** or **design**.

- **Built and specced** (all in `hypercomb-essentials/src/mail/`, none of it wired or registered):
  - `template.ts`: the format, the strict reader, fill checking, rendering, the message part, and the outline
    an audit reads. 143 specs in `template.spec.ts`.
  - `template-pool.ts`: the templates a hive keeps (list, save, take off), and the audit report. 28 specs in
    `template-pool.spec.ts`.
  - `template-form.ts`: the form a template asks. 22 jsdom specs in `template-form.spec.ts`.
  - The pool `mail:template`, seeded in core (`SCOPED_POOL_MEANINGS`, and kind `set` in `pool-kinds.ts`).
  - The form's words, in both catalogs under `mail.template.*`.
- **Not wired yet:** the send, the read pane, the composer and the queen's published-pool claim. They are
  steps 2 and 3, and the exact touch points are below.
- **Design only:** step 4, activation and the script view. No script runs anywhere.

This document goes with `mail-plan.md` section 8.

jwize, 2026-11-06: *"there should be pools of meaning which are templates, and they can be audited and fill in
the blanks with variables. This opens up incredibly expressive emails. Trust the community and trust the
resources, so you are able to have even animated scripts in emails."*

## The idea in five lines

1. A **template** is one artifact. Its bytes have one signature (I1), and it declares its **holes**: names
   arranged, a schema of holes, the *layout* relation of N4. It is the mail equivalent of a layout template
   (`layout-templates.md`): one shared resource that many uses point at by signature, and never a parent.
2. A **message that uses one** carries `{ template: <sig>, fill: { hole: value } }` in a part of its own, and
   beside it the static text and html the sender **baked** at send, so any outside reader still gets a complete
   email.
3. A Hypercomb reader renders the message from **its own copy** of the template. Whoever audited those bytes
   audited every message that names them (M1).
4. **Holes are typed**, and every value is checked and escaped by its type before anything renders.
5. **Trust is the activation gate's answer** for the template's signature (T3, T5). Today it changes one bit,
   `live`, and runs nothing.

## The format (built)

A template is a UTF-8 JSON document of at most 256 KB:

| field | | |
|---|---|---|
| `"mail:template": 1` | required | the self-declaring key and version; anything else is refused |
| `name` | required | one line, ≤ 120 characters |
| `description` | optional | one line, ≤ 500 |
| `subject` | optional | one line, ≤ 200, may hold holes (no pictures) |
| `holes` | required (may be `{}`) | ≤ 64, keyed by name: lowercase letters, digits, `-` and `_`, starting with a letter, ≤ 40 |
| `text` | required | the plain body: always rendered, always sent |
| `html` | optional | the html body, in the closed subset below |
| `resources` | optional | ≤ 32 of the template's own pictures, `{ name: <sig> }`; `{{@name}}` shows one |
| `script` | optional | a signature, **declared only** (step 4) |

A hole is `{ type, of?, required?, label?, max? }`:

| type | a value is | shown in html | shown in text |
|---|---|---|---|
| `text` | a string, ≤ `max` (default 2,000, at most 20,000), no control or direction-override characters | escaped; line breaks become `<br>` | as written |
| `url` | http, https or mailto that parses, ≤ 2,048, no `user:pass@` | a link to itself; plain text inside a link or `<code>`; the whole of an `href` | the URL |
| `number` | a finite number | formatted for the locale | formatted |
| `date` | ISO 8601: a real date, or a date and time **with its zone** | a long date (a date alone is never shifted by a zone) | the same |
| `resource` | a 64-hex signature | a picture, only when the reader holds the bytes (below); otherwise words naming the signature | `[picture: label]` |
| `list` | an array of the scalar type `of`, ≤ `max` items (default 50, at most 200) | `<li>` items directly inside `<ul>`/`<ol>`, joined with `, ` elsewhere | `- item` lines when the hole is alone on its line, joined with `, ` elsewhere |

Holes are written `{{name}}`, and the template's own resources are written `{{@name}}`.

**The html subset.** These are the tags `format.ts` writes (`p br h1 h2 strong em code ul ol li blockquote a`),
plus `h3` and `hr`. `mail-html.ts` keeps both, and neither carries an attribute, loads anything or acts. The
only attributes are `a[href]` (a literal http/https/mailto URL, or one `url` hole as the whole value), `a[rel]`
(`noopener noreferrer nofollow ugc`; the output always says `noopener noreferrer`), and `ol[start]`. The content
model is strict, so that what the browser builds is what was audited:

- `p`, `h1` to `h3`, `strong` and `em` hold inline content only (`strong em code a br`, text, holes).
- `a` holds no other link.
- `code` holds text and holes only.
- `ul` and `ol` hold `li` and list holes only.
- `li` and `blockquote` hold anything.
- Nesting stops at depth 16.

There is no `img` tag: pictures come only from holes and resources, and this module writes the tag.

**An example** (the bytes `templateBytes` writes are 1,072 bytes):

```json
{
  "mail:template": 1,
  "name": "Tasting night",
  "subject": "You are invited: {{event}}",
  "holes": {
    "guest": { "type": "text", "required": true, "label": "Who it is for" },
    "event": { "type": "text", "required": true, "label": "What it is" },
    "when":  { "type": "date", "required": true, "label": "When" },
    "place": { "type": "url", "label": "Where (a map link)" },
    "seats": { "type": "number", "label": "Seats left" },
    "bring": { "type": "list", "of": "text", "max": 8, "label": "What to bring" },
    "photo": { "type": "resource", "label": "A picture of the room" }
  },
  "text": "Dear {{guest}},\n\nYou are invited to {{event}} on {{when}}.\nSeats left: {{seats}}\n\nPlease bring:\n{{bring}}\n\nThe way there: {{place}}\n{{@logo}}",
  "html": "<h1>{{event}}</h1><p>Dear {{guest}},</p><p>You are invited on <strong>{{when}}</strong>. Seats left: {{seats}}.</p><h3>Please bring</h3><ul>{{bring}}</ul><p>{{photo}}</p><p><a href=\"{{place}}\">The way there</a></p><hr><p>{{@logo}}</p>",
  "resources": { "logo": "<the logo's signature>" }
}
```

The fill, and the part it travels in (358 bytes here):

```json
{ "mail:fill": 1, "template": "<the template's signature>",
  "fill": { "guest": "Leanne", "event": "Cigars & coffee", "when": "2026-11-20T19:30:00-08:00",
            "place": "https://www.openstreetmap.org/#map=18/49.28/-123.12", "seats": 6,
            "bring": ["a cutter", "a story"], "photo": "<the room picture's signature>" } }
```

Rendered with `timeZone: 'America/Vancouver'` by a reader that holds neither picture (actual output):

```
subject  You are invited: Cigars & coffee
text     Dear Leanne,

         You are invited to Cigars & coffee on November 20, 2026 at 7:30 PM.
         Seats left: 6

         Please bring:
         - a cutter
         - a story

         The way there: https://www.openstreetmap.org/#map=18/49.28/-123.12
         [picture: logo]
html     <h1>Cigars &amp; coffee</h1><p>Dear Leanne,</p>…<ul><li>a cutter</li><li>a story</li></ul>
         <p><em>[picture cccccccccccc… is not shown here]</em></p><p><a href="https://www.openstreetmap.org/…"
         rel="noopener noreferrer">The way there</a></p><hr>…
blocked  resource <photo sig>: not-held, resource <logo sig>: not-held
live     false
```

## The API (built)

```ts
parseTemplate(bytes: Uint8Array, expectedSig?: string): Promise<
  { ok: true; template: MailTemplate; sig: string } | { ok: false; reason: string }>
templateBytes(doc: MailTemplateDocument): Uint8Array           // the canonical writer: one template, one signature
validateFill(template: Pick<MailTemplate, 'holes'>, fill: unknown): { ok: true; fill: MailFill } | { ok: false; problems: string[] }
renderTemplate(template: MailTemplate, fill: unknown, deps: RenderDeps): RenderedMail
  // deps: { trust(sig) => 'admitted' | 'held' | 'unknown', resolveResource?(sig) => { type, bytes } | null,
  //         images?: 'data' | 'cid', locale?, timeZone?, say?(key, fallback, params) }
  // ok: { subject, text, html, live, blocked: { kind: 'resource'|'script', sig, why }[], images: { sig, type, cid }[] }
  // not ok: { problems }
mailPart(templateSig: string, fill: MailFill): { type: 'application/vnd.hypercomb.mail+json', filename, body,
  header: { name: 'X-Hypercomb-Template', value } } | null
readMailPart(mail: { attachments: { type, size? }[] }, attachmentBytes: (i) => Uint8Array | null): { templateSig, fill } | null
outlineTemplate(template: MailTemplate): { links: { href: { url } | { hole } | null, text }[],
  senderLinks: string[], senderPictures: string[], names: string[] } | null   // what an audit reads
MAIL_TEMPLATE_LIMITS, MAIL_TEMPLATE_KEY, MAIL_FILL_KEY, MAIL_TEMPLATE_PART_TYPE, MAIL_TEMPLATE_HEADER, MAIL_TEMPLATE_PART_FILENAME
```

All of these are pure. None throws. The module registers nothing and imports nothing. `parseTemplate` is
async only because sha256 in a browser is async.

Fill problems read `<hole>: <why>`, with `why` from a fixed vocabulary, so a window can say them in words:
`required`, `unknown`, `forbidden`, `not-a-value`, `not-text`, `too-long`, `control-characters`, `not-a-link`,
`not-a-number`, `not-a-date`, `not-a-signature`, `not-a-list`, `too-many`, plus `fill: not-an-object`,
`too-many-values`, `too-large` and `unreadable`. The two strings a reader may see go through `say`, with keys
`mail.template.picture` and `mail.template.picture-missing`; English is the fallback. Both keys are in
`en.json` and `ja.json`.

## The refusals (built), each with a reason, never stripped

`mail-html.ts` cleans a stranger's html by dropping what can act. A template is meant to be audited, and an
audit of bytes that are quietly changed on the way to the screen is an audit of something else. So the whole
template is refused when it has any of these:

- **Bytes:** more than 256 KB, not UTF-8, not JSON, a key repeated in one object (`JSON.parse` keeps the last
  copy, and a reader of the bytes may see the first), any key named like a member of `Object.prototype`
  (`__proto__`, `constructor`, …) or `prototype`, anywhere, or bytes that do not match the signature they were
  held under.
- **Shape:** an unknown field at any level, a version other than 1, a missing name or text, a hole type outside
  the six, `of` on anything but a list, a list of lists, `max` on anything but text or list or over its ceiling,
  a non-boolean `required`, a bad hole or resource name, more than 64 holes or 32 resources, a resource or
  script that is not a 64-hex signature, a subject on two lines, a picture in the subject.
- **Holes:** a `{{` that does not form a hole (so `{{{a}}}` and an unclosed `{{a` are refused), a hole or
  `@resource` the template does not declare, more than 256 holes in all.
- **Characters:** control characters, and the direction embeddings, overrides and isolates
  (U+202A–U+202E, U+2066–U+2069), in any string or character reference. A template has to read the way it
  renders.
- **Html:** any other tag (`script`, `iframe`, `style` with or without `url(`, `base`, `meta`, `img`, `svg`,
  `form`, …), any other attribute (`onload`, `style`, `target`, …), a comment or conditional comment, a
  doctype, a bare `<` or `&`, an unknown or control character reference, a link that is not http/https/mailto
  (including `javascript&#58;` spelled with references, `data:`, and `https://bank@evil/`), a non-url hole in an
  `href`, an `href` that is a hole and more, a link inside a link, a block inside a paragraph, an `li` outside a
  list, text directly in a list, a scalar hole directly in a list, a tag that is misnested or never closed,
  nesting past 16.

**A fill** is refused before anything renders when it is not a plain object, or has more than 64 values, an
unknown or prototype-named key, a getter (it is never called), a missing or blank required hole, or a value of
the wrong type or over its cap. Length is checked first, so a 10 MB string or a 10,000-item list is refused
without being read. The fill's strings together are capped at 64 KB. `renderTemplate` checks the fill again
itself, so an unchecked fill can never be half-rendered into a message.

**When rendering**, a value is never read again for holes: `{{other}}` in a text hole arrives as those
characters. A subject is folded to one line, so a fill cannot add a header (`Ana\nBcc: …`). Rendered text or
html over 1 M characters (pictures not counted) is refused.

**A picture** shows only when the reader's own `resolveResource` returns bytes, and only when the type is png,
jpeg, gif or webp, the first bytes agree with that type (so an SVG labelled `image/png` stays out), and it is at
most 2 MB (8 MB per rendering). Anything else becomes words naming the signature, plus an entry in `blocked`.
Nothing is fetched, and there is no URL anywhere to fetch (T7).

**Every occurrence counts.** The heap holds a picture once, but the html pays for every place it is written, so
the picture data written into one html is capped at the base64 of 8 MB (`pictureChars`), each occurrence
counted. The moment the cap would be passed, nothing more is written and the rendering is refused as
`render: too-large`, so the string never grows (security review R2, finding 4: 150 × `{{@pic}}` over one
2 MB png was 400 MB of html, rendered as `ok`). One 2 MB picture can therefore appear four times. In `cid` mode
a picture is one inline part however often it is named, so this cap does not apply there.

## Audited once, by signature (M1)

Auditing a template means reading its bytes, so the audit is a fact about one signature, and it holds for
every message that names that signature, forever (I1). A message cannot change what a template is: it brings
only a fill, and the fill is data of declared types that the template's own rendering escapes. Two things make
the audit one that anyone can repeat without trusting the auditor:

1. **The reader is strict.** What it accepts is exactly what will render. No repeated keys, no stripped tags,
   no direction tricks.
2. **The record is the brood's.** An audit is `attachAudit` in `hypercomb-core/src/core/brood.ts`: it reads,
   scores and recommends, it can never accept, and the report is kept by its signature. That is the same door a
   stranger's bee goes through, and for the same reason: reading hostile content can never compromise
   anything.

A template with no script needs no audit to be **safe** to show: the reader makes it safe by construction. The
audit is for whether it is **honest** (a phishing letter can be perfectly well-formed), and, once scripts exist,
for whether it may **run**.

**The mechanical reading (built, `template-pool.ts`).** `auditTemplate(template)` reads the template's outline
and writes a report for a person to judge:

```json
{ "mail:template-audit": 1, "template": "<sig>", "by": "template-reader", "hosts": ["hypercomb.com"],
  "findings": [ { "kind": "links-to", "subject": "hypercomb.com" },
                { "kind": "link-words-name-another-place", "subject": "bank.example/login",
                  "target": "https://evil.example/login" },
                { "kind": "sender-chooses-link", "subject": "link" } ] }
```

The finding kinds, in the order they are listed:

- `links-to`: every host its literal links can send a reader to (for `mailto`, the domain written to).
- `link-words-name-another-place`: the link's words read as an address and the link goes elsewhere. This
  includes words that name a place the sender chooses through a url hole, because the template cannot keep
  that promise.
- `sender-chooses-link` and `sender-chooses-picture`: url and resource holes, including lists of them.
- `names-resource`: the template's own pictures.
- `declares-script`.

The report has no date in it, so one template always gives one report and one signature. `auditBytes` writes
it canonically. `recordTemplateAudit(store, template)` keeps the report as a resource and returns the brood
entry, `{ reportSig, summary, by: 'template-reader', recommends: 'unclear' }`. The reading **always recommends
`unclear`**, even for a template that reaches nothing, because only a person can say a letter is honest.
Attaching that entry with `attachAudit` waits for step 4: the brood holds bees only today.

## How a template travels

- **The bytes** (built) are a resource at the content root, `<root>/<sig>` (S2), stored once however many tiles
  and messages name them (A6).
- **Membership** (built) is the pool `mail:template`, of kind `set` (seeded in `pool-kinds.ts`), federated by
  union (P1, P6, M3). The pool holds membership, never the template's truth; see the next section.
- **From hosts you follow, never from a sender** (T1, T7; design). A host publishes the pool the way it publishes any
  pool: one file at `<origin>/<sign('mail:template')>` listing the members
  (`hypercomb-essentials/src/sharing/published-pools.ts`). The probe verifies every member's hash and **holds**
  it as an offer. `/offers` (`offers.queen.ts`, `offers.view.ts`) is the yes, a press on a row (T4). A message
  never makes its reader fetch a template: a reader who does not hold it sees the baked copy.
- **As a tile** (A1; design): "save as template" breaks a message apart. The composer's message becomes the
  template, the spans the participant marks become holes, and the template is one artifact that stands alone.

## The templates a hive keeps (built, `template-pool.ts`)

```ts
MAIL_TEMPLATE_MEANING = 'mail:template'
listTemplates(store?): Promise<{ entries: ({ sig, ok: true, template } | { sig, ok: false, reason })[],
  problem?: 'no-store' | 'unreadable' }>
saveTemplate(store, doc: MailTemplateDocument): Promise<{ ok: true, sig, added } | { ok: false, reason }>
forgetTemplate(store, sig): Promise<{ ok: true, sig, added: false } | { ok: false, reason }>
auditTemplate(template) / auditBytes(report) / recordTemplateAudit(store, template)
```

The store is reached through IoC (`@hypercomb.social/Store`), or passed in. Every call is optional on it, so a
store without one of them gives an answer and never a throw.

- **One document, and it is the index a host serves.** The pool holds one current document,
  `{"meaning":"mail:template","members":[sig, …]}`, written by `putPoolDoc`. That is exactly the shape
  `published-pools.ts` reads (`membersOf`) from `<origin>/<sign('mail:template')>`, so offering the pool later
  means serving these bytes as they are. Every member is already at `<origin>/<sig>`. There are at most 64
  members, the most one host may offer per meaning, so the list always publishes whole.
- **A save keeps the list before it.** No write passes `keep: 'current'`, because a save is the participant's
  act. Taking a template off the list is **hiding** it: its bytes stay, every message that names it still
  renders, and the earlier list still names it.
- **Never a raw write.** A set pool's members were written with a raw `createWritable` everywhere until now. The
  storage ratchet freezes those per file, so this module uses the store's document writer and nothing else.
- **Save proves before it writes.** `templateBytes` writes the canonical bytes and `parseTemplate` must read
  them back. The store must answer with the same signature (S3). Only then does the list gain the member.
  Saving the same template twice writes nothing. Saves run one at a time, so two at once are both kept.
- **Complete or not at all.** A list on disk that does not read (a foreign shape, a non-signature member, more
  than 64), or a pool that holds a document the store could not read, is never rewritten as a shorter list:
  the save is refused and the list is left as it is.
- **Listing never mints and never asks a host.** It opens the pool with `openPool` (which never creates) and
  reads each member with `getResourceLocal`, by its signature, through `parseTemplate(bytes, sig)`. A member
  that does not read is kept in the answer with its reason: not held, larger than 256 KB (refused before it is
  read), bytes that do not match their name, or the parse refusal.

## The form a template asks (built, `template-form.ts`)

```ts
templateForm(template: MailTemplate, say: (key, fallback, params?) => string,
  options?: { pickResource?(hole): Promise<string | null>, onChange?(): void, initial?: MailFill })
  → { element: HTMLElement, fill(): MailFill, problems(): { hole: string | null, item?, why, words }[], dispose() }
```

- **Built from the holes alone**, in the author's order. Each `label` is the question (the hole's name when
  there is none), and a required hole says so.
  - `text`: a line up to 200 characters, a box beyond that.
  - `url`: a link field.
  - `number` and `date`: their inputs. A date may carry a time, and a day plus a time is sent as the instant
    it names (`toISOString`), so every reader sees it in their own zone.
  - `resource`: a signature field, plus a "From the shelf" button when `pickResource` is given (A9). Only a
    64-hex answer is taken, and an answer that comes after `dispose` writes nothing.
  - `list`: rows, added up to `max` and removed. Empty rows are not items.
- **Text only.** Labels are the author's words and reach the page through `textContent`. A spec checks that
  the source never parses markup and imports nothing but `./template.js`.
- **The form collects; `validateFill` decides.** `fill()` is what was entered, typed, with empty fields left
  out. `problems()` asks `validateFill` and puts each problem beside its field: on the row for a list item
  (counting only filled rows, as `validateFill` does), and under the form for the fill as a whole. Typing
  clears what was said.
- **The window's material.** It wears the mail window's own classes (`hc-mail-form`, `hc-mail-field`,
  `hc-mail-do is-small`, `hc-mail-status is-bad`), so inside the window it has the same 2px shape and colours,
  and it brings no stylesheet of its own.
- **Its words** are under `mail.template.*` in `en.json` and `ja.json`: `required`, `time`, `signature`,
  `pick`, `add-item`, `remove-item`, and `problem.{required, too-long, too-many, control-characters,
  not-a-link, not-a-number, not-a-date, not-a-signature, too-large, other}`.

## The three gates, and exactly what "admitted" will mean (design)

The trust function `renderTemplate` asks answers for one signature (T5: selection, intake and activation, never
conflated):

| answer | means | the reader shows |
|---|---|---|
| `unknown` | this hive does not hold the template's bytes | the **baked html** the sender put in the message, through `makeMailHtmlSafe` and the script-less sandboxed frame, as for any mail |
| `held` | the bytes are in the heap, they hash to their name, and the template is a member of `mail:template` (placed by a press, or authored here); it was **selected** (a followed host) and **kept** (intake) | the template's **own rendering**, which is safe by construction and is what was audited (see decision 4); no script |
| `admitted` | held, **and** it passed **activation**, the gate a bee passes | the template's own rendering, and (step 4) its script |

"Admitted" is the same three proofs a package passes (T2), asked at admission and never at runtime:

1. **Integrity.** The template's bytes hash to its signature, and so do the script's and every resource's.
   This is the store's S3; `parseTemplate(bytes, sig)` checks it again.
2. **Completeness.** The closure has no holes: the template, its `script`, and every `resources` signature are
   held. A template whose script is missing is held, never admitted.
3. **Authority**, by one of two doors from `activation-authority.ts`:
   - **attested:** a publisher the participant follows names the template's signature in a signed index (the
     way `features publish` signs `pool:features:participant`, so here a signed `pool:mail:template`); or
   - **hand:** the participant accepted it in the brood with the two warnings (`acceptIntoHive`). An audit can
     recommend and never accept.

   Then the brood rules have the last word, exactly as `mayRunBee` does for a bee: your own ruling wins either
   way, and a stranger with no vouches stays held.

**What a reader who has not admitted it sees:** a complete email. It is the template's rendering when held (no
script, pictures only from their own heap), and the baked html in the script-less frame otherwise. The `blocked`
list says a script was declared and not run, so the window can say so in words.

**What a script will be allowed to do once admitted (T7, design for step 4):** run in a sandboxed frame of its
own (`allow-scripts`, never `allow-same-origin`, so it has an opaque origin with no OPFS, no IoC and no key),
under a policy of `default-src 'none'`, with the script itself allowed by its hash, `img-src data:`,
`connect-src 'none'`, `base-uri 'none'` and `form-action 'none'`. It receives the checked fill and the pictures
the reader holds by `postMessage`, and nothing else. No network at all, which is stricter than T7's "only our
hosts", because animation needs none.

## Steps 2 to 4: where each touches existing files (steps 2 and 3 to wire, step 4 design)

**Step 2: send carries the part.**

- `hypercomb-essentials/src/mail/mail.service.ts`, `send(request)`: `SendRequest` gains
  `template?: { sig: string; fill: MailFill }`. When it is present, `send` calls
  `mailPart(sig, fill)` and appends `{ filename: part.filename, type: part.type, content: utf8(part.body) }`
  to the list it hands to `wireAttachments`, and puts `template: sig` in the JSON body. The part takes one of
  the ten attachment slots (`MAIL_LIMITS.attachments`), so the composer offers nine when a template is in use.
- `hypercomb-relay/mail-worker/worker.js`, `send()`: **the part already passes through untouched.**
  `attachmentsOf` accepts `application/vnd.hypercomb.mail+json`, a base64 body and the filename. Cloudflare gets
  it with `disposition: 'attachment'`, and the sealed Sent copy keeps it, so a Sent message is read back with
  the same `readMailPart`. The only Worker change is the header: read `body.template` (64 lowercase hex, or
  refuse 422) and add `X-Hypercomb-Template` to the `threading` headers object. The existing `E_HEADER`
  fallback then sends without headers, and the part still goes. The header is a hint for filters and other
  clients; the part is the truth.
- **Pictures for outside readers.** Gmail and Outlook do not show `data:` images, so the baked html is rendered
  with `images: 'cid'`, and each entry of `images` has to travel as an inline part with `Content-ID: <cid>`.
  The Worker hardcodes `disposition: 'attachment'` today. It would need an optional, validated `contentId` per
  attachment that becomes `disposition: 'inline'`. **Unverified:** whether Cloudflare's `send_email` binding
  takes a content id at all. If it does not, outside readers get the picture as an attachment, and the baked
  html says its words instead.

**Step 3: the reader renders.**

- `mime.ts`: nothing required. The part already lands in `ParsedMail.attachments`, typed. Exposing
  `X-Hypercomb-Template` is optional (it is only a hint).
- `mail.view.ts`, the read pane, in the branch that calls `makeMailHtmlSafe(pane.mail.html, …)` and
  `mailFrameDocument`: first `readMailPart(pane.mail, i => attachmentBytes(raw, i))`. The window needs the raw
  bytes for that. If `MailService.read` still returns only a `ParsedMail`, it needs a sibling that returns the
  raw bytes too (C1's file). On a hit: get the template's bytes from the heap by signature, call
  `parseTemplate(bytes, sig)`, then `validateFill(template, read.fill)`, then `renderTemplate` with the gate's
  answer. On `ok`, put `out.html` through `makeMailHtmlSafe` anyway (defence in depth, and a no-op on the
  subset) into the same frame. On a miss, an `unknown` template or any `ok: false`, show the baked html exactly
  as today. The template part is left out of the attachment list the pane shows.
- **Resources are synchronous to the renderer, asynchronous in the heap.** The view gathers the signatures
  first (`template.resources` and every resource-typed value of the fill), reads each from the store into a
  map, and passes `sig => map.get(sig) ?? null`. **Gap:** the heap keeps bytes without a type. The type has to
  come from the record that placed the resource (the `files:attachment` record `mail-to-hive.ts` writes, or the
  resource's meta envelope). `renderTemplate` refuses it unless the bytes agree.
- **The pool.** The core half is **done**:
  - `'mail:template'` is in `SCOPED_POOL_MEANINGS` (`hypercomb-core/src/core/pool-registry.ts`), which also
    makes `mail` a reserved colon scope. Without it the store spelled the meaning `mail-template`, a bare word
    and so the lineage bag of a tile named "mail template".
  - It is seeded as kind `set` in `pool-kinds.ts`.
  - `MAIL_TEMPLATE_MEANING` lives in `template-pool.ts`.

  Still to wire: **the queen**, not a dependency, claims the published pool with `registerPublishedPool({
  meaning: MAIL_TEMPLATE_MEANING, accept })`. Its kind `set` replicates, so the claim is accepted. The handler
  holds an offer; it keeps nothing until the participant presses its row in `/offers` (T4).
  - **Gap:** `accept(record, origin)` receives the parsed record, not the verified bytes or their signature. A
    template handler needs both: `parseTemplate` is strict on bytes, and `JSON.parse` has already hidden a
    repeated key. The additive fix is a third argument `{ sig, bytes }` that the existing handlers ignore (H3).
    `MAX_MEMBER_BYTES` there is already 256 KB, the same as a template's cap.
- **The composer** (`mail.view.ts`; the pieces are built):
  - "Use a template" lists `listTemplates()` (its `ok` entries; a refused entry can show its reason).
  - The chosen template mounts `templateForm(template, say, { pickResource, onChange })` in the compose pane.
    `pickResource` is the shelf's hand (A9). The shelf's API for "give me a picture's signature" is not
    settled here.
  - Send: `form.problems()` must be empty. Then `renderTemplate(template, form.fill(), { trust: 'held', images:
    'cid', resolveResource })` bakes the subject, text and html, and `send` carries them with
    `template: { sig, fill: checked fill }`.
  - The form is `dispose()`d when the composer closes or the template changes.
  - "Save as template" breaks the message apart (A1). `format.ts`'s html and text become the template's bodies,
    and the spans the participant marks become holes. Then `saveTemplate(store, doc)`, and optionally
    `recordTemplateAudit`.
- **What the read pane trusts until step 4.** `held` when the template is an `ok` entry of `listTemplates()`
  (the participant kept it), `unknown` otherwise. `renderTemplate`'s `trust` is synchronous, so the view
  computes this before it renders.

**Step 4: activation and the script view** (design only; no code yet).

jwize, 2026-11-06: *"trust the community and trust the resources so you are able to have even animated scripts
in emails."* A script therefore runs when, and only when, **the gate admits the template's signature**, and
never before. Each piece below names the file it touches.

*The gate: `hypercomb-essentials/src/mail/template-gate.ts` (new, a dependency).*
`templateTrust(sigs): Promise<Map<sig, 'admitted' | 'held' | 'unknown'>>` is computed before a render, because
`renderTemplate`'s `trust` is synchronous. For one signature:

1. **`unknown`**: `getResourceLocal(sig)` is null, or `parseTemplate(bytes, sig)` refuses.
2. **`held`**: the bytes read, and the template is an `ok` entry of `listTemplates()`, kept by the participant
   (saved here, or pressed in `/offers`).
3. **`admitted`**: held, and also:
   - **Complete.** `getResourceLocal` holds the `script` and every `resources` signature, and each hashes to its
     name. The script is UTF-8 text of at most 256 KB.
   - **Authorized**, by one of the doors below.

   Then the brood has the last word.

*Authority, the attested door: `hypercomb-essentials/src/sharing/package-attestation.ts` (touched).*

- The publish side copies `participant-features.ts:125`. The outbound act (the promote window, "Publish")
  stamps `setHiveRoot(host, 'pool:mail:template', <sig of the current list document>)`. It is not a typed word:
  `template` is already a behaviour word.
- The reader side is a sibling of `attestPackage`: `attestPoolMember('pool:mail:template', templateSig, zones,
  deps)`. It reuses `readInstallFollow`, `indexHostsFor` and `fetchHiveIndex` unchanged. The followed index's
  `roots['pool:mail:template']` names a list. The list's bytes must hash to that signature and read as the
  members document, and the template must be a member.
- Forged, unreachable and not-named answer exactly as for a package.
- Witnessing reuses the existing `witness` function with the storage key as a parameter. That file's
  `localStorage.setItem` count is frozen by the storage ratchet, so no new call site.

*Authority, the hand door, and the last word: `hypercomb-core/src/core/brood.ts` (touched, additive, H3).*

- `BroodRecord.kind` widens from `'bee'` to `'bee' | 'mail-template'`. `holdInBrood(sig, source, name, kind =
  'bee')` gains the kind.
- A template arriving from a host is held as a stranger's arrival. One saved here is held as `own`, which the
  brood rules admit, as they do a participant's own draft bee.
- `mayRunBee` is already kind-blind; it gains the alias `mayRun` for this caller, and nothing about a bee
  changes.
- `attachAudit(sig, (await recordTemplateAudit(store, template)).audit)` attaches the reading, and it can never
  rule.
- `acceptIntoHive(sig, warnings)` is the hand. Its two distinct warnings for a template:
  1. "This template's script will run in its own frame each time you open a message that uses it."
  2. "It cannot reach the network, your tiles or your key, but it can show anything, including something that
     misleads."
- `write()` already holds the brood's one raw write, so no ratchet count moves.

*The script view: `hypercomb-essentials/src/mail/template-live.view.ts` (new) and `mail.queen.ts` (touched).*

- It is a second face of the message (A5): a framework-free custom element `hc-mail-template-live`, owned by
  the mail queen.
- The queen contributes it the way `comfy-desk.drone.ts:44` does: `window.ioc.whenReady(
  '@hypercomb.social/ShellSurfaceRegistry', r => r.add({ name: 'mail-template-live', owner: <view key>,
  element: 'hc-mail-template-live', order }))`. The element is defined only on its first request, the way the
  sandbox door's panel is (`sandbox-door.drone.ts:85`).
- The read pane asks for it with a transient effect (never a replayed one) that carries the template sig and
  the checked fill. The pane asks only when `renderTemplate` said `live`.
- The frame:
  - `<iframe sandbox="allow-scripts">`, never `allow-same-origin`, so it gets an opaque origin with no OPFS, no
    IoC and no key. No popups: links stay in the static rendering beside it.
  - `referrerpolicy="no-referrer"`.
  - `srcdoc` is a fixed document: a CSP `<meta>` of `default-src 'none'; script-src 'sha256-<the script's
    hash>'; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; frame-src 'none';
    worker-src 'none'; base-uri 'none'; form-action 'none'`, then the script inline.
- In: one `postMessage` after `load`, `{ kind: 'mail:template:fill', fill, pictures: { sig: dataUrl } }`, with
  only the pictures the reader holds.
- Out: only `{ kind: 'mail:template:height', px }` from `event.source === frame.contentWindow`, clamped.
  Anything else is ignored.
- The frame is removed when the pane closes.
- `template.ts`: when `live`, `blocked` stops saying `not-run` for the script and the rendering carries
  `script: sig`. That is one line and its spec, and it lands with this view and not before.
- **Unverified, to check before step 4 lands:**
  - A `srcdoc` frame inherits the shell's own CSP, so the shell's policy must allow the hash-allowed inline
    script.
  - Browsers may run a sandboxed frame in the page's own process, so a busy script could freeze the tab. The
    first release should start the live view on a press and give it a stop.

## Decisions for jwize

1. **The hole type set**: `text url number date resource list` as built. Candidates left out on purpose: a
   choice from a fixed set, a colour, money with a currency, rich text (it would need its own audited subset).
2. **Where templates are authored.** "Save as template" in the composer is designed above. A typed word is not
   free: **`template` is already a behaviour word** (`commands/template.queen.ts`, layout templates), and a
   sub-word of a queen must not be a behaviour word of its own (CLAUDE.md, community translations). So
   `mail template …` would run the layout queen too. A tile broken apart is the third way.
3. **The first trusted publisher set** for `pool:mail:template`: the install publisher, or a separate follow.
4. **What a held but not admitted template shows**: its own rendering (recommended here: safe by construction,
   and it is the audited bytes, so a sender cannot bake one thing and name another), or the sender's baked html
   (the plan's wording).
5. **Outside recipients**: the baked html and the text (with inline `cid:` pictures if Cloudflare carries them),
   or the text only.
6. **Scripts in the first release**: yes, under the frame above, or not until a second release. Whether a
   script may ever reach a host (it reaches none in this design). Whether the live view starts by itself once
   admitted, or on a press with a stop (recommended for the first release, see step 4's unverified items).
8. **Who may stamp `pool:mail:template`**: only the install publisher the participant already follows (the
   attester as it is), or any publisher the participant follows for templates (a second follow record).
7. **Styling**: whether a scrubbed `style` attribute or a fixed set of classes joins the subset. Static templates
   carry no styling in this release, and the expressive layer is meant to be the script view.

## What is not built yet

No script runs, and nothing here fetches. Nothing is wired into `mail.view.ts`, `mail.service.ts`,
`mail.queen.ts` or the Worker, and nothing registers a published pool, a shell surface or an IoC key. The
built modules are dependencies that wait for those wirings (steps 2 and 3, above). Step 4 is design until it
lands with its own specs.
