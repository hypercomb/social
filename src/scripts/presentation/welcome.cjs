// THE FRONT DOOR OF hypercomb.com, as one small file the host serves.
//
//   node scripts/presentation/welcome.cjs           # write dist/welcome.json
//   node scripts/presentation/welcome.cjs --print   # show it, write nothing
//
// The apex is a HOST now: it serves the shim, publishes packages by signature,
// and opens the add-a-domain card to anyone whose browser is holding nothing.
// That card is therefore also this domain's website — and a website that can
// only offer a text field has lost every link the splash used to carry.
//
// So the links are given back to it as CONTENT. `welcome.json` is staged next
// to the shell at deploy time and read by the card (hypercomb-shim/src/
// bootstrap/welcome.ts); the shim itself stays generic and knows nothing about
// hypercomb.com. Any host may stage its own, and a host with none renders the
// plain card it always did.
//
// The directory of doors is the SAME derivation the presentation splash bakes
// in — hosts.cjs, from the worker's ledger of signed heads — so the two pages
// can never disagree about what is live, and neither asks a third party for it
// at view time (documentation/no-third-party-requests.md).
const fs = require('fs')
const path = require('path')
const hosts = require('./hosts.cjs')

const OUT = path.join(__dirname, 'dist', 'welcome.json')

// The tour is the presentation, kept whole and moved to /tour/ when the shim
// took the apex. It is the first link because it is the one thing this domain
// most wants read: nineteen minutes that explain the rest.
//
// /downloads/ is documentation/hypercomb.com — the welcome page that carries
// the desktop release status and the two browser utilities, with their sizes,
// checksums and install steps. It was written, kept current, and served
// NOWHERE; the deploy stages that whole directory, so these two links are the
// first time either file has been downloadable from this domain.
const compose = (doors) => ({
  title: 'hypercomb',
  tagline: 'An open software platform. Your work is named by its own content, '
    + 'kept in your hands, and carried by the people who use it.',
  links: [
    { label: 'Watch the tour', href: '/tour/', note: '≈ 19 minutes · narrated, with captions' },
    { label: 'Open hypercomb.io', href: 'https://hypercomb.io', note: 'the main app — start a hive of your own' },
    { label: 'Downloads', href: '/downloads/', note: 'desktop app · Windows, macOS, Linux' },
    { label: 'Browser extensions', href: '/downloads/#extensions', note: 'Smart Autolinker · No YouTube Shorts' },
  ],
  doorsLabel: `live on ${hosts.ZONE} · ${doors.length} ${doors.length === 1 ? 'hive' : 'hives'}`,
  doors: doors.map(d => ({ title: d.title, host: d.host })),
})

// hosts.json is refreshed by every presentation build and committed, so this
// reads it rather than dialling the ledger again: a deploy with no network
// stages exactly what the last build proved.
const welcome = () => compose(hosts.load().doors)

const write = () => {
  const door = welcome()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(door, null, 2) + '\n')
  console.log(`welcome: ${OUT} — ${door.links.length} link(s), ${door.doors.length} door(s)`)
  return OUT
}

module.exports = { welcome, write, OUT }

if (require.main === module) {
  if (process.argv.includes('--print')) console.log(JSON.stringify(welcome(), null, 2))
  else write()
}
