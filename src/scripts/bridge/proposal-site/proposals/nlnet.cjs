// NLnet Restack — nlnet-proposal.hypercomb.com
//
// One page per tile. `slug` is the tile name under the site's root tile
// (`site.lineage`); the first page is the root tile itself.
//
// To make another proposal: copy this file, change `lineage`, `funder`,
// `brand` and the pages that differ. The facts come from ../facts.cjs.

const { measure, fmt, PROJECT: P } = require('../facts.cjs')

module.exports = function nlnet() {
  const m = measure()

  return {
    lineage: 'nlnet-proposal',
    domain: 'nlnet-proposal.hypercomb.com',
    title: 'Hypercomb · NLnet Restack proposal',
    funder: 'NLnet · Restack fund',
    summary: 'Verifiable, consent-based hosting for content-addressed hives: the trust and consent layer that lets independent hosts carry each other\'s signed content.',
    draft: 'Draft — the amounts and wording are still being settled before submission.',
    docsBase: `${P.repo}/blob/main/src/documentation`,
    brand: { name: 'Hypercomb' },
    footer: [
      'Every page here is a tile in a Hypercomb hive, published as signed content.',
      `Code ${P.licenseCode} · Docs ${P.licenseDocs}`,
      `[Source](${P.repo})`,
      `[${P.contact}](mailto:${P.contact})`,
      `Repository figures measured ${m.measuredAt}`,
    ],
    pages: [
      {
        slug: '',
        nav: 'Overview',
        eyebrow: 'Proposal to NLnet Restack',
        title: 'Verifiable, consent-based hosting for content-addressed hives',
        lede: 'Hypercomb is a working, local-first workspace where everything is named by the SHA-256 of its bytes. This proposal funds the missing layer between independent hosts: who may host whose content, who may advance it, and how anyone can check both.',
        blocks: [
          { type: 'stats', items: [
            { n: fmt(m.commits), label: `commits since ${m.first}` },
            { n: fmt(m.specs), label: 'test files in the TypeScript suite' },
            { n: fmt(m.rustTests), label: 'Rust tests in the native client' },
            { n: '2', label: 'implementations: browser (TypeScript) and native (Rust)' },
          ] },
          { type: 'prose', h: 'In one paragraph', p: [
            'People and communities publish inside platforms that own the account, the copy and the address. Hypercomb takes the other route. Your content lives on your own device, every piece is named by its signature, and any host can serve it over a plain `GET /<signature>`. Readers check what they receive against its name. There are no accounts and no central server.',
            'Hosting and verifying bytes already works. Trust between hosts does not exist yet: binding a domain to the keys that may advance its content, defining who may write what on a host, and letting a host agree to carry someone else\'s content under limits it sets. That is the work this grant pays for, delivered as a written protocol, conformance tests, and two implementations that pass them.',
          ] },
          { type: 'cards', h: 'Where it fits in Restack', items: [
            { kicker: 'THEME', title: 'Alternatives to closed online services', text: 'A personal workspace and publishing surface with no accounts and no central server.' },
            { kicker: 'THEME', title: 'Deployment and client-side counterparts', text: 'Host a hive from your own machine, a static host or a domain, with a native client for Windows, macOS and Linux.' },
            { kicker: 'THEME', title: 'Standards for interoperability', text: 'A written protocol, Nostr event kinds and Blossom endpoints, checked by vectors shared between both implementations.' },
          ] },
          { type: 'cards', h: 'Read the proposal', items: [
            { kicker: '01', title: 'The problem', text: 'Why the address, the copy and the account should not belong to the platform.', href: '/problem' },
            { kicker: '02', title: 'What already works', text: 'The software running today, and the live hosts serving it.', href: '/today' },
            { kicker: '03', title: 'The work', text: 'Five milestones, each with a check a reviewer can run.', href: '/plan' },
            { kicker: '04', title: 'Budget', text: 'What each milestone costs and delivers.', href: '/budget' },
          ] },
        ],
      },

      {
        slug: 'problem',
        nav: 'The problem',
        title: 'The platform owns the account, the copy and the address',
        lede: 'When the service decides, the work stops existing elsewhere. Moving it means asking permission, and checking it means trusting the host.',
        blocks: [
          { type: 'prose', p: [
            'Most personal and community publishing today depends on one operator. It issues the account, holds the only authoritative copy, and controls the address people use to find the work. When that operator changes its terms, shuts down or refuses someone, the work goes with it.',
            'Federated systems spread the load, but most still tie identity and content to a server. Your account lives on an instance and your posts are addressed by where they are stored, so moving means migrating and readers trust whichever server they reach.',
          ] },
          { type: 'list', h: 'What a commons needs instead', items: [
            '**Names that come from the content.** If the address is the hash of the bytes, any copy anywhere is the same thing, and a reader can prove it.',
            '**A copy that belongs to the author.** The authoritative store is on the author\'s device, and a host only carries a replica.',
            '**Hosts that are interchangeable.** Any static web server, CDN or home machine can serve the bytes without special software.',
            '**Trust that does not need a platform.** A domain proves who publishes, a key proves who may update, and a host decides what it agrees to carry.',
          ] },
          { type: 'callout', title: 'The gap this proposal closes', p: [
            'Hypercomb already delivers the first three. The fourth, trust and consent between independent hosts, is designed but not built. Without it, hosting someone else\'s content means trusting them completely, or refusing.',
          ] },
        ],
      },

      {
        slug: 'today',
        nav: 'What already works',
        title: 'Software that runs today',
        lede: 'This is not a prototype waiting for funding. The workspace, the publishing path and the hosts are live. This page and every other page here are served by them.',
        blocks: [
          { type: 'table', h: 'Running now', cols: ['Part', 'What it does', 'Where'], rows: [
            ['Web workspace', 'Local-first hive in the browser. Content is stored in the Origin-Private File System, every artifact named by its SHA-256.', `[hypercomb.io](${P.app})`],
            ['Native client', 'One Tauri 2 project for Windows, macOS and Linux. The hive is a single redb database and can serve itself over HTTP.', '`hypercomb-client`'],
            ['Published sites', 'A publish IS the deployment. A domain opens a signed tree, read-only, using the same engine.', 'this site'],
            ['Content endpoint', 'Signature-named blobs over Cloudflare R2, speaking Blossom BUD-01/02/06. Any Blossom client can read it with no Hypercomb code.', `[pluginthematrix.com](${P.content})`],
            ['Bootstrap relay', 'Nostr relay for presence and signed claims. Bulk content never travels through it.', `\`${P.relay}\``],
            ['Domain claim', 'One command claims a domain for a key. The apex becomes the front door and each subdomain a publishable site.', '`domain claim <name>`'],
          ] },
          { type: 'stats', h: 'Measured from the repository', items: [
            { n: fmt(m.commits), label: `commits, first on ${m.first}` },
            { n: fmt(m.specs), label: 'TypeScript test files' },
            { n: fmt(m.rustTests), label: 'Rust tests' },
            { n: fmt(m.docs), label: 'documentation pages' },
          ], note: 'Counted from the git checkout when this site was built, not typed in by hand.' },
          { type: 'list', h: 'Built on open standards', items: [
            '**Nostr** for signals: NIP-01, 07, 11, 33, 40, 42 and 98.',
            '**Blossom** for bytes: BUD-01, 02 and 06 on the public endpoint.',
            '**Plain HTTP**: any static host can serve a hive. Cloudflare Pages, a folder behind Caddy, or `hypercomb-serve` on your own machine.',
            `**Free licences**: code under ${P.licenseCode}, documentation under ${P.licenseDocs}.`,
          ] },
        ],
      },

      {
        slug: 'plan',
        nav: 'The work',
        title: 'Five milestones, each one checkable',
        lede: 'Each milestone ends in something a reviewer can run or read, and none depends on trusting the author.',
        blocks: [
          { type: 'milestones', items: [
            { n: '1', status: 'partial', title: 'Protocol v1 and a cross-implementation conformance suite',
              text: 'Freeze the wire format and publish the specification as a standalone document. Extend the shared test vectors so the TypeScript and Rust implementations must produce identical bytes for every case.',
              deliverable: 'Both implementations pass the published vectors in CI, and the spec is versioned v1.',
              refs: ['protocol-spec.md', 'primitive-conformance-audit.md'] },
            { n: '2', status: 'designed', title: 'Domain ↔ key trust root',
              text: 'A domain publishes the keys that may advance its content inside its own signed history, read over its own TLS. Verifiers check every head against that key set: DNS and TLS prove the domain, and the signature proves the key.',
              deliverable: 'A head signed by an unlisted key is rejected by both implementations, with vectors for each case.',
              refs: ['protocol-spec.md'] },
            { n: '3', status: 'designed', title: 'Marker-append write contract',
              text: 'Define who may advance a lineage on a host: append-only, no gaps, no overwrite, and only by the domain\'s keys. Anyone can store the bytes, but only the author can move the head.',
              deliverable: 'The host refuses out-of-order and wrongly signed appends, and the tests cover every refusal.',
              refs: ['protocol-spec.md', 'mesh-domain-resolver-audit.md'] },
            { n: '4', status: 'designed', title: 'Consent hosting between strangers',
              text: 'A host agrees to carry a third party\'s signed content under a quota it sets, and can refuse or stop at any time without breaking anyone\'s ability to verify. Today only fixed-limit hosting for shared rooms exists.',
              deliverable: 'A request, grant and signed upload handshake, working between two independently run hosts.',
              refs: ['consent-hosting.md', 'hosting-from-a-machine.md'] },
            { n: '5', status: 'new', title: 'Standardisation',
              text: 'Write up the Hypercomb Nostr event kinds as a NIP draft, and align the content endpoint with the Blossom BUDs it does not yet cover, so other projects can interoperate without reading the code.',
              deliverable: 'A NIP draft opened upstream and a Blossom compatibility table published.',
              refs: ['public-content-endpoint.md'] },
          ] },
          { type: 'callout', title: 'Help asked from NLnet\'s partners', p: [
            'A security review of milestones 2 to 4, and an accessibility review of the published sites. These are non-financial services Restack already offers.',
          ] },
          { type: 'prose', h: 'Out of scope', p: [
            'Encrypted mesh transport and signed native releases are planned, but kept for a follow-up so this grant stays bounded. The workspace\'s optional AI features are outside Restack\'s scope and outside this proposal. Nothing above depends on them.',
          ] },
        ],
      },

      {
        slug: 'budget',
        nav: 'Budget',
        title: 'What the money buys',
        lede: 'A first Restack grant ranges from €5,000 to €50,000. Every euro maps to a milestone and a deliverable.',
        blocks: [
          { type: 'table', cols: ['Milestone', 'Deliverable', 'Estimate'], rows: [
            ['1 · Protocol v1 + conformance', 'Spec v1, vectors passing in both implementations', 'to be set'],
            ['2 · Domain ↔ key trust root', 'Key-set verification with vectors', 'to be set'],
            ['3 · Write contract', 'Append rules enforced by the host, with tests', 'to be set'],
            ['4 · Consent hosting', 'Handshake between two independent hosts', 'to be set'],
            ['5 · Standardisation', 'NIP draft and Blossom compatibility table', 'to be set'],
          ], foot: ['Total requested', '', 'up to €50,000'] },
          { type: 'list', h: 'How it is costed', items: [
            'One hourly rate, used for every task.',
            'Hours are estimated per task, and each milestone is paid when its deliverable is shown.',
            'Running costs are already covered: the content endpoint and relay run on existing infrastructure.',
          ] },
        ],
      },

      {
        slug: 'comparison',
        nav: 'Other efforts',
        title: 'How this relates to other efforts',
        lede: 'Hypercomb reuses existing standards wherever they fit, and builds only the parts they do not cover.',
        blocks: [
          { type: 'compare', items: [
            { name: 'IPFS', same: 'Content addressing: the name is derived from the bytes.', diff: 'The address is bare SHA-256 hex over the raw bytes, with no CID or multiformat layer, so any static web host can serve it without running a daemon.' },
            { name: 'Nostr', same: 'Keys, signed events and relays. Hypercomb uses NIP-01/07/11/33/40/42/98 directly.', diff: 'Nostr carries live presence and signed head claims only. Bulk content goes over HTTP or Blossom, never through relays.' },
            { name: 'Blossom', same: 'Signature-named blobs over HTTP. The endpoint implements BUD-01/02/06.', diff: 'Hypercomb adds the parts above the blob: history heads, closure replication, and the consent and trust rules this proposal funds.' },
            { name: 'ActivityPub', same: 'Federation between independently run servers.', diff: 'No server-held accounts. Content is addressed by what it is, not by which instance stores it, so moving hosts needs no migration.' },
            { name: 'AT Protocol', same: 'Portable identity and content you can move between providers.', diff: 'No separate data-server, relay and app-view tiers. A static host is enough, and the reader does the verifying.' },
            { name: 'Solid', same: 'The person, not the app, owns the data.', diff: 'A Solid pod is location-addressed storage behind a server. A hive is content-addressed and lives on the author\'s device first.' },
          ] },
          { type: 'prose', h: 'Contributing upstream', p: [
            'Yes, Hypercomb builds on these projects. It uses Nostr and Blossom as they are, recommends established relays such as strfry or nostr-rs-relay for production, and milestone 5 sends its own extensions back upstream as drafts.',
          ] },
        ],
      },

      {
        slug: 'challenges',
        nav: 'Technical challenges',
        title: 'The hard parts',
        lede: 'Most of the difficulty is in agreeing on trust without a central authority, and in keeping two implementations byte-identical.',
        blocks: [
          { type: 'list', items: [
            '**Trust without a central authority.** A domain has to name the keys that may advance its content, using only what it already has: DNS and TLS. No new certificate authority, and no registry.',
            '**Concurrent writers to an append-only history.** Nothing in a hive is ever deleted. The write contract must say who may append, and how conflicts resolve, without rewriting anything.',
            '**Consent and abuse.** A host must be able to take only what it agreed to, under quota, and refuse or evict later, without making the content unverifiable for anyone else.',
            '**Privacy against deduplication.** Convergent encryption keeps deduplication but reveals when two people hold the same thing, and random keys hide that but lose it. Each fits a different case.',
            '**Verified replication at scale.** A replica resolves a signature\'s whole closure and checks every atom before writing it, so a single bad byte is refused rather than stored.',
            '**Two implementations, one behaviour.** The browser stores into OPFS and the native client into redb. The conformance vectors are the contract that keeps them producing the same bytes.',
          ] },
        ],
      },

      {
        slug: 'ecosystem',
        nav: 'Ecosystem',
        title: 'Who it depends on, and who it serves',
        blocks: [
          { type: 'cards', h: 'Depends on', items: [
            { title: 'Nostr relays', text: 'Its own minimal relay, or strfry and nostr-rs-relay in production.' },
            { title: 'Blossom', text: 'The blob protocol for public bytes.' },
            { title: 'Any static host', text: 'Cloudflare Pages, Caddy, or a systemd service on a home machine.' },
            { title: 'Tauri 2 and redb', text: 'The native client and its single-file store.' },
          ] },
          { type: 'list', h: 'Who uses it', items: [
            'Individuals and small communities who want their own domain and their own copy.',
            'People willing to host other people\'s signed content on their own machine or domain.',
            'Translators, who already publish signed language catalogs to hosts that others follow.',
          ] },
          { type: 'list', h: 'How we will engage', items: [
            'Open a NIP draft for the event kinds, and align with the Blossom BUDs.',
            'Publish the conformance vectors so any third implementation can test itself against them.',
            'Write documentation for hosts as well as authors, since a commons needs both.',
          ] },
        ],
      },

      {
        slug: 'team',
        nav: 'Who builds it',
        title: 'Who builds it',
        blocks: [
          { type: 'prose', p: [
            `${P.maintainer} designs and maintains Hypercomb through ${P.company}, and is its primary author.`,
          ] },
          { type: 'list', h: 'Track record you can check', style: 'check', items: [
            `${fmt(m.commits)} commits since ${m.first}, with ${fmt(m.specs)} TypeScript test files and ${fmt(m.rustTests)} Rust tests.`,
            'CI workflows that build the native client for Windows, macOS and Linux.',
            `Infrastructure in production: the bootstrap relay \`${P.relay}\`, the public content endpoint, and the published sites, including this one.`,
            '"Doctrine ratchets" in the test suite, which fail the build if a known architectural mistake reappears.',
          ] },
          { type: 'prose', h: 'Contact', p: [ `[${P.contact}](mailto:${P.contact}) · [Source code](${P.repo})` ] },
        ],
      },

      {
        slug: 'ai',
        nav: 'Use of AI',
        title: 'How generative AI is used',
        lede: 'NLnet asks applicants to disclose any substantive use of generative AI. Here it is in full.',
        blocks: [
          { type: 'stats', items: [
            { n: fmt(m.assisted), label: `of ${fmt(m.commits)} commits carry a Co-Authored-By: Claude trailer` },
          ], note: 'Counted from commit trailers when this site was built.' },
          { type: 'prose', p: [
            'Development uses Claude through Claude Code as a pair programmer. The maintainer sets the design, directs each change, reviews it, and answers for it. The architecture and its rules, the doctrine the test suite enforces, are the maintainer\'s own.',
            'For grant-funded milestones, AI-assisted work will be logged with the model and prompt details NLnet\'s policy asks for, and the paid work is the design, review and verification.',
            'The text of this site was drafted with Claude Opus 5.5 from the repository\'s own documentation, and the maintainer reviews it before it is published. The answers in the NLnet form itself are written by the applicant.',
          ] },
          { type: 'callout', p: [ 'None of the funded milestones includes the workspace\'s AI features, and the core protocol does not depend on them.' ] },
        ],
      },
    ],
  }
}
