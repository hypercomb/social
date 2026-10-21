// The portal — proposals.hypercomb.com
//
// A directory of every proposal Hypercomb has open, for the people they are
// for: funders, reviewers, hosts, and anyone who wants to help. The directory
// is read from proposals/*.cjs at build time, so a new proposal file is a new
// row here with nothing else to edit. The portal is a peer of the proposals
// it lists, never their container: each proposal is its own hive at its own
// door, and this one only points.

const { measure, fmt, PROJECT: P } = require('./facts.cjs')
const { listProposals } = require('./load-site.cjs')

module.exports = function portal() {
  const m = measure()
  const proposals = listProposals()
  const open = proposals.filter(p => ['draft', 'submitted'].includes(p.site.meta?.status))

  const card = ({ name, site }) => ({
    kicker: (site.meta?.kind || 'Proposal').toUpperCase(),
    title: site.funder,
    text: site.summary,
    href: `https://${site.domain}`,
    meta: [site.meta?.ask, site.meta?.deadline ? `deadline ${site.meta.deadline}` : ''].filter(Boolean),
    status: site.meta?.status,
  })

  return {
    lineage: 'proposals',
    domain: 'proposals.hypercomb.com',
    title: 'Hypercomb · Proposals',
    funder: 'Funding & partners',
    summary: 'Every proposal Hypercomb has open, in one place: what is asked, of whom, by when, and how to take part.',
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
        nav: 'Proposals',
        eyebrow: 'Directory',
        title: 'What Hypercomb is asking for, and of whom',
        lede: 'Hypercomb is a working, local-first workspace where every artifact is named by the hash of its bytes and any host can serve it. These are the proposals that would fund the parts still to build. Each is its own site; open one to read it in full.',
        blocks: [
          { type: 'cards', h: open.length === proposals.length ? 'Open proposals' : 'Proposals', items: proposals.map(card) },
          { type: 'stats', h: 'The project behind them', items: [
            { n: fmt(m.commits), label: `commits since ${m.first}` },
            { n: fmt(m.specs), label: 'TypeScript test files' },
            { n: fmt(m.rustTests), label: 'Rust tests' },
            { n: fmt(m.docs), label: 'documentation pages' },
          ], note: 'Counted from the repository when this site was built.' },
          { type: 'cards', h: 'Read on', items: [
            { kicker: '01', title: 'What we are building', text: 'The commons the proposals pay for, in one page.', href: '/why' },
            { kicker: '02', title: 'How to take part', text: 'Fund, review, host, or follow along.', href: '/involved' },
          ] },
        ],
      },
      {
        slug: 'why',
        nav: 'What we are building',
        title: 'A commons for personal and community publishing',
        lede: 'Content that belongs to its author, addressed by what it is, served by whoever agrees to, and verifiable by anyone.',
        blocks: [
          { type: 'prose', p: [
            'Most publishing today depends on one operator who issues the account, holds the only copy and controls the address. Hypercomb takes the other route. Content lives on the author\'s own device, every piece is named by the SHA-256 of its bytes, and any static host can serve it over a plain `GET /<signature>`. Readers check what they receive against its name. There are no accounts and no central server.',
            'The workspace, the publishing path, the native client and the hosts already run. What the proposals fund is the layer between independent hosts: who may host whose content, who may advance it, and how anyone can check both.',
          ] },
          { type: 'list', h: 'Built on open standards', items: [
            '**Nostr** for signals and signed claims.',
            '**Blossom** for bytes on the public endpoint.',
            '**Plain HTTP** for hosting: Cloudflare Pages, a folder behind Caddy, or a machine of your own.',
            `**Free licences**: code under ${P.licenseCode}, documentation under ${P.licenseDocs}.`,
          ] },
          { type: 'callout', title: 'Every proposal is a hive', p: [
            'Each proposal site is a Hypercomb hive published at its own door. The pages you are reading are tiles, signed and content-addressed, served the same way anything else in Hypercomb is.',
          ] },
        ],
      },
      {
        slug: 'involved',
        nav: 'How to take part',
        title: 'Fund it, review it, host it, or follow it',
        lede: 'There is more than one way in, and none needs an account.',
        blocks: [
          { type: 'cards', items: [
            { kicker: 'FUND', title: 'Funders and sponsors', text: `Each proposal names a bounded piece of work with a deliverable a reviewer can check. Write to [${P.contact}](mailto:${P.contact}) to talk about any of them, or about a scope not listed.` },
            { kicker: 'REVIEW', title: 'Reviewers', text: `The code, the tests and the documentation are public at [${P.repo.replace('https://', '')}](${P.repo}). Every number on these pages is counted from that repository when the site is built.` },
            { kicker: 'HOST', title: 'Hosts', text: 'A host is a directory of static files answered over HTTP. Run one from a static host or your own machine and carry signed content for others; consent hosting is what the first proposal funds.' },
            { kicker: 'FOLLOW', title: 'Followers', text: 'In your own hive, `hold proposals.hypercomb.com` keeps this directory as a link tile that follows its live head. Each proposal\'s door can be held the same way.' },
          ] },
          { type: 'prose', h: 'Contact', p: [ `[${P.contact}](mailto:${P.contact}) · [Source code](${P.repo}) · [hypercomb.io](${P.app})` ] },
        ],
      },
    ],
  }
}
