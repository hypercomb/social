const WebSocket = require('ws')

const send = (req, t = 15000) => new Promise(res => {
  const ws = new WebSocket('ws://localhost:2401')
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: 'n' + Math.random().toString(36).slice(2) })))
  ws.on('message', m => { try { res(JSON.parse(String(m))) } catch { res({ raw: String(m) }) } ws.close() })
  ws.on('error', e => res({ ok: false, error: e.message }))
  setTimeout(() => res({ ok: false, error: 'TIMEOUT' }), t)
})

const notes = [
  'THE QUESTION — Should the trust-domain security layer move into a Chrome extension, so running scripts can be audited and bad actors cannot host their own domain and run malicious code? Or at least a redundancy there.',

  'VERDICT — As a REPLACEMENT: no. An extension cannot prevent execution on an origin the attacker controls, and auditing the running scripts is not soundly decidable under dynamic import plus import maps. As a REDUNDANCY: yes, but not the one the question describes — the value is trust state that survives the origin boundary, and a prompt the page cannot forge. DO FIRST: converge the gates. That is a refactor, not a new distribution channel.',

  'GATE A — INSTALLER ACTIVATION, keyed on SOURCE DOMAIN. TrustService.check fires when code is turned on, never at download. Adoption is downloading bytes and is always safe; activation is letting code execute. Denial is durable and legible — the node becomes an UNTRUSTED EGG: known, visible, cannot hatch. Lives in hypercomb-shared/core/trust-service.ts, called only from the DCP installer at home.component.ts lines 2736, 2824, 2938.',

  'GATE B — RENDER REVIEW GATE, keyed on SIGNATURE PLUS PATH. featureNeedsReview is fail-closed: a foreign unverified heavy feature (a website, a game) does not mount, does not run scripts, does not pull resources. Composes four signals — isForeignContent, isLocallyAuthored, isFeatureAvailable, isWithinAllowedRoot — with domain as only one of them. Lives in feature-availability.ts line 153, called from site-view.drone.ts line 496 and show-features.drone.ts line 1302.',

  'GATE C — THE ROSTER, keyed on ENABLEMENT STATE. Where a decision becomes runtime effect: if DCP says a bee is off, it must not pulse. script-preloader.ts line 150. The only place where NOT TRUSTED turns into DOES NOT EXECUTE.',

  'THE LESSON GATE B ALREADY LEARNED — The self-domain is seeded from the deployment origin, so on a shared origin every participant carries the SAME self-domain and a peer adopted page arrives attributed to your domain. Comparing domains alone RAN FOREIGN CODE UNGATED. The repair was tree position plus per-signature authorship. Domain identity already degraded under exactly the condition the extension proposal worries about, and the fix was to lean on signatures.',

  'ALREADY SOLVED — Every fetched byte is sha256-verified against the signature that requested it, at every tier of the fetch cascade and in the service worker path. A wrong or hostile domain list can only cost a 404, never serve wrong bytes. CONTENT INTEGRITY IS NOT THE GAP. What a malicious host can do is offer you ITS OWN signatures and persuade you to activate them — a social problem at the activation boundary, not a transport problem.',

  'THREAT T1 — Attacker serves a hostile shell on their own origin and the user visits. CONTAINED by the browser origin sandbox: OPFS is per-origin, they cannot read the user hive, they get a hive of their own to vandalize. An extension can warn but cannot stop the page. Weakest as a control, strongest as a witness.',

  'THREAT T2 — User adopts a malicious bee and activates it at home. THE THREAT THAT ACTUALLY HURTS: a bee that registers in IoC has full access to the participant tree. Already GATED by A and B at the activation step, which is the right boundary. An extension adds nothing structural here.',

  'THREAT T3 — Attacker writes themselves into the trusted community list. GENUINE SOFT SPOT: the community domains key is per-origin localStorage that the page itself can write. This is the strongest case for an extension — extension storage is unwritable by any page and is ONE list across all origins instead of N attacker-controlled copies.',

  'THREAT T4 — A trusted domain later turns hostile or is compromised. PARTIAL: the Gate B signature set holds, since a verified sig stays verified whatever its domain does later; Gate A has this failure mode in full. An argument for signatures over domains, wherever the check runs.',

  'WHAT AN EXTENSION CAN DO — Hold state no page can read or write. Render UI the page cannot forge or suppress. Observe network activity the page cannot hide. Attest which shell you are actually running. WHAT IT CANNOT DO — Prevent execution on a hostile origin, since MV3 removed blocking webRequest and CSP injection before parse is racy and easily sidestepped. Soundly enumerate the running scripts, because dynamic import, import maps, blob and data URLs, workers and eval leave you a best-effort census rather than a proof. Make that census mean anything against a host that never claimed a signature. Protect anyone who has not installed it, which is everyone at first contact.',

  'DISTRIBUTION COST — A REQUIRED extension inverts the stated posture: presence-first, no account system, works from a URL. It becomes a store-reviewed install gate, hands Google a veto over our security layer, and abandons Firefox, Safari and mobile. An OPTIONAL extension protects only the already-cautious. Not fatal, but a real cost against a benefit narrower than it first appears.',

  'RECOMMENDATION — TRUST THE SIGNATURE, NOT THE DOMAIN. If activation is gated on the artifact signature against a set the participant has vetted, then where it was served from stops being load-bearing: either the host serves bytes whose signature you already trust, or it serves different bytes with a different signature and the gate fires. The sha256 cascade already guarantees the first branch cannot be forged. Gate A adopts the Gate B composite formula; the two gates share ONE definition of trusted; domain trust survives as what it already is in practice — a prompt-skipping heuristic and a fetch-ordering preference.',

  'IF WE BUILD IT — A WITNESS, NOT A SECURITY LAYER. One: origin-independent community list in extension storage, writable only through the extension UI, which fixes T3 outright. Two: a prompt that cannot be forged, rendered outside the page. Three: shell attestation badge — hash the delivered shell and show its signature, green when the user has seen it before. That is the honest version of auditing the running scripts: a true statement of what was DELIVERED. OUT OF SCOPE: blocking execution, enumerating dynamic imports, scanning pages for malice, being required for the app to function.',

  'STAGED — Stage 01: converge Gate A onto the signature-first formula and write down one definition of trusted (refactor, no new surface). Stage 02: make community-list writes deliberate and legible — one writer, visible in the pools UI, an audit trail of when each domain was added and by what gesture. Stage 03: extension capabilities one and two, optional, degrading cleanly to in-page when absent — THE DECISION POINT, where the distribution cost is incurred. Stage 04: the shell attestation badge. Stages 01 and 02 are worth doing whether or not the extension is ever built.',

  'OPEN QUESTIONS — What is the artifact a trust decision is keyed on? Gate B already found that per-signature verification broke adopted sites across reloads, so branch-scoped allow is the working answer; is it right for code too? Should trust decisions be SHAREABLE — a signed community attestation fits the mesh far better than a per-device list, and may beat the extension entirely. Does the egg model generalize? Who is the attacker we are actually defending against — if the answer is T2 and T3, the extension is a stage-three nicety, not a security layer.',

  'WHERE IT LIVES — Paper: src/documentation/trust-boundary-and-the-extension-question.md, committed to development as 7b04a6f75. Artifact: https://claude.ai/code/artifact/4e4dc325-4f60-4c27-8908-8a820944f4aa. Companion to security.md and known-location-pools.md.'
]

;(async () => {
  let i = 0
  for (const text of notes) {
    const r = await send({ op: 'note-add', segments: ['creations'], cell: 'chrome-security', text })
    i++
    console.log(String(i).padStart(2, '0'), r.ok ? 'ok' : 'ERR ' + r.error)
  }
  const list = await send({ op: 'note-list', segments: ['creations', 'chrome-security'] })
  const n = (list.data?.notes ?? list.data ?? [])
  console.log('note-list →', Array.isArray(n) ? n.length + ' notes' : JSON.stringify(list).slice(0, 200))
})()
