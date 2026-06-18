// Humanity Centres — site content.
//
// Authored once; rendered to standalone preview AND stamped into the hive
// by the same engine. Voice: warm, plain, honest, invitational. Humanity
// Centres is an EMERGING non-profit — we speak in the language of vision
// and invitation, never of track record we don't have.
//
// Integrity rules baked into this copy (from the research pass):
//  • Real organisations (Bethlehem Centre; the neighbourhood-house
//    movement / ANHBC) are named only as INDEPENDENT, attributed
//    examples — never as partners, members, hosts, or our property.
//  • Borrowed phrases ("community living room", "third place",
//    "spirituality without borders", the SSIR definition) are attributed.
//  • No charity/tax-deductibility claims; the Purse is described as a
//    model we are building, transparently.
//  • Per-place Indigenous territories named in present tense.
//  • Switzerland / Bermuda are horizons we dream toward, not operations.

// Friendly breadcrumb labels keyed by tree path.
const LABELS = {
  'humanity-centres': 'Home',
  'humanity-centres/programs': 'Programs',
  'humanity-centres/programs/me': 'Me',
  'humanity-centres/programs/us': 'Us',
  'humanity-centres/programs/all-of-us': 'All of us',
  'humanity-centres/purse': 'The Purse',
  'humanity-centres/participants': 'Who comes',
  'humanity-centres/places': 'Places',
  'humanity-centres/places/locations': 'Where we are',
  'humanity-centres/places/qualities': 'What makes a centre',
  'humanity-centres/places/types': 'Kinds of place',
  'humanity-centres/places/types/retreat-centres': 'Retreat centres',
  'humanity-centres/places/types/neighbourhood-houses': 'Neighbourhood houses',
  'humanity-centres/places/types/storefronts': 'Storefronts',
  'humanity-centres/practitioners': 'Practitioners',
}

const S = (p) => ['humanity-centres', ...p.split('/').filter(Boolean)]

// External, clearly-attributed references (open in a new tab).
const EXT = {
  bethlehem: 'https://bethlehemcentre.com',
  anhbc: 'https://anhbc.org',
  thirdplace: 'https://www.pps.org/article/roldenburg',
  pwyc: 'https://www.oneworldeverybodyeats.org',
  ssir: 'https://ssir.org/articles/entry/era-of-relational-intelligence',
}

const PAGES = [

// ─────────────────────────────────────────────────────────────────────
// 1 · LANDING
// ─────────────────────────────────────────────────────────────────────
{
  segments: S(''),
  hero: 'humanity-centres',
  kicker: 'A not-for-profit in formation',
  kickerIcon: 'seed',
  title: 'Places to practise being human, together.',
  lede: 'Humanity Centres are gathering places — retreat centres, neighbourhood houses, and storefronts — where people come to relate well, belong, and heal. Not a programme you complete. A place you can keep coming back to.',
  ctas: [
    { label: 'See how it works', href: S('programs'), kind: 'primary', icon: 'compass' },
    { label: 'Support the work', href: S('purse'), kind: 'ghost', icon: 'heart' },
  ],
  sections: [
    {
      type: 'prose',
      eyebrow: 'The idea', icon: 'spark',
      heading: 'Relating well is a skill — and skills get stronger with practice.',
      lead: true,
      paras: [
        'Some things you can’t learn from a screen. You learn them in a room, across a table, in a circle — by being human with other humans. The capacity to listen, to repair, to stay connected through tension, to belong to one another — that’s what some now call <strong>relational intelligence</strong>. As the <em>Stanford Social Innovation Review</em> puts it, it’s “the deeply human ability to build trust, navigate tension, repair ruptures, and create meaning with others.”',
        'Humanity Centres exist to give that practice a home. We’re building places where the door is genuinely open, where you can arrive as nothing in particular and simply be met — and where, over time, relating well starts to feel like coming home.',
      ],
    },
    {
      type: 'cards',
      eyebrow: 'How it fits together', icon: 'hex',
      heading: 'Five parts of one living thing',
      intro: 'Programmes for the journey. Places to hold them. People who come and people who host. And a shared purse that keeps every door open.',
      cards: [
        { title: 'Programs', href: S('programs'), img: 'programs/all-of-us', icon: 'compass', tag: 'me · us · all of us', blurb: 'A journey of relational scope — from the self, to a relationship, to a whole community.' },
        { title: 'Places', href: S('places'), img: 'places/types/neighbourhood-houses', icon: 'pin', tag: 'where it happens', blurb: 'Retreat centres, neighbourhood houses, and storefronts — different doors into the same welcome.' },
        { title: 'Who comes', href: S('participants'), img: 'participants/location', icon: 'people', tag: 'everyone', blurb: 'You don’t have to arrive as anything in particular. Just come as a human.' },
        { title: 'The Purse', href: S('purse'), img: 'purse', icon: 'purse', tag: 'solidarity, not charity', blurb: 'A shared fund: what comes in is pooled and sent back out, so no one practises being human alone.' },
        { title: 'Practitioners', href: S('practitioners'), img: 'practitioners/location', icon: 'hands', tag: 'who holds the room', blurb: 'The people who tend the space, hold the circle, and make the welcome real.' },
      ],
    },
    {
      type: 'features',
      eyebrow: 'A living tradition', icon: 'leaf',
      heading: 'We didn’t invent this. We’re learning from places that already do it.',
      intro: 'For well over a century, people have built physical places to practise belonging. Humanity Centres draws inspiration from three of them — honestly, and without claiming to be them.',
      items: [
        { img: 'places/types/neighbourhood-houses', title: 'The neighbourhood house', body: 'The movement describes each house as a “community living room — a place where everyone belongs,” caring for the whole person, the whole family, and the whole neighbourhood. That phrase belongs to the <a href="' + EXT.anhbc + '" target="_blank" rel="noopener">neighbourhood-house movement</a>, not to us — but it names exactly what we’re reaching for.' },
        { img: 'places/qualities/other-facilities', title: 'The retreat', body: 'In Nanaimo, on the shore of Westwood Lake, the independent <a href="' + EXT.bethlehem + '" target="_blank" rel="noopener">Bethlehem Centre</a> has welcomed people “to learn, heal, and grow” for decades — proof that a place built for being human together isn’t an abstraction. We point to it as inspiration, not affiliation.' },
        { img: 'places/types/storefronts/circles-in-the-square', title: 'The third place', body: 'A storefront on a familiar street — somewhere that isn’t home and isn’t work, where you’re known by name and welcome to simply be. Ray Oldenburg called these the <a href="' + EXT.thirdplace + '" target="_blank" rel="noopener">“third places”</a> that hold a community together. Ours gather in circles.' },
      ],
    },
    {
      type: 'quote',
      text: 'Me. Us. All of us. It starts with how you meet yourself, grows in how you meet another, and ripples out into how a whole community holds each other.',
      cite: 'The shape of the work',
    },
    {
      type: 'callout',
      heading: 'We’re early — and that’s the invitation.',
      body: 'Humanity Centres is taking shape now, rooted in British Columbia with horizons further afield. There’s no track record to dress up; there’s a vision, and an open hand. Come help shape what it becomes.',
      ctas: [
        { label: 'Understand the Purse', href: S('purse'), kind: 'primary', icon: 'purse' },
        { label: 'Where we’re rooted', href: S('places/locations'), kind: 'ghost', icon: 'globe' },
      ],
    },
  ],
},

// ─────────────────────────────────────────────────────────────────────
// 2 · PROGRAMS
// ─────────────────────────────────────────────────────────────────────
{
  segments: S('programs'),
  hero: 'programs/all-of-us',
  kicker: 'Programs', kickerIcon: 'compass',
  title: 'One journey, three circles wide.',
  lede: 'Relational intelligence scales outward — from your relationship with yourself, to the people closest to you, to the whole community you belong to. Our programmes follow that arc: me, us, all of us.',
  sections: [
    {
      type: 'prose',
      lead: true,
      paras: [
        'Relating well isn’t a fixed trait you’re born with or without. It’s a capacity that grows with practice — and like any practice, it needs a place and good company. Each programme is a different radius of the same circle, and you’re welcome to begin wherever you are.',
      ],
    },
    {
      type: 'cards',
      eyebrow: 'The three programmes', icon: 'circle',
      heading: 'Begin where you are',
      cards: [
        { title: 'Me', href: S('programs/me'), img: 'programs/me', icon: 'self', tag: 'the self', blurb: 'The quiet, brave work of meeting yourself — so you can meet others without losing yourself.' },
        { title: 'Us', href: S('programs/us'), img: 'programs/us', icon: 'two', tag: 'the relationship', blurb: 'Two people learning to stay connected through tension — to listen, to repair, to stay.' },
        { title: 'All of us', href: S('programs/all-of-us'), img: 'programs/all-of-us', icon: 'people', tag: 'the community', blurb: 'Belonging built on purpose — a whole community learning to hold one another.' },
      ],
    },
    {
      type: 'quote',
      text: 'Relational intelligence is “the deeply human ability to build trust, navigate tension, repair ruptures, and create meaning with others.”',
      cite: '— Stanford Social Innovation Review, on the field this work draws from',
    },
    {
      type: 'callout',
      heading: 'A place to practise, not just to learn.',
      body: 'You can read about relating well anywhere. You can only rehearse it with people, in person — over and over, until it becomes a way of being. That’s what the places are for.',
      ctas: [
        { label: 'See the places', href: S('places'), kind: 'primary', icon: 'pin' },
        { label: 'Read about the field', href: EXT.ssir, kind: 'ghost', icon: 'spark' },
      ],
    },
  ],
},

// 3 · ME
{
  segments: S('programs/me'),
  hero: 'programs/me',
  kicker: 'Programs · Me', kickerIcon: 'self',
  title: 'It begins with how you meet yourself.',
  lede: 'Before “us” and before “all of us,” there’s the relationship you have with the person you’ll never leave: you. Me is the inner work that lets you show up for everyone else.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'You can’t pour belonging from an empty cup. The first circle is the smallest and the bravest — learning to notice what you feel, to set a boundary without a wall, to be kind to yourself when you fall short. It’s not navel-gazing; it’s the groundwork that makes real connection possible.',
        'In a Humanity Centre, “me” looks like a quiet room, a walk by the water, a journal, a conversation that doesn’t rush you. Sometimes it’s a labyrinth to walk inward and find your way back out again. The work is gentle, and it’s yours.',
      ],
    },
    {
      type: 'cards', eyebrow: 'What it can look like', icon: 'leaf', two: true,
      cards: [
        { title: 'Stillness & reflection', icon: 'moon', more: false, blurb: 'Space to slow down — contemplation, journaling, time in nature, room to hear yourself think.' },
        { title: 'Knowing your patterns', icon: 'compass', more: false, blurb: 'Gently noticing how you relate — what you reach for under stress, and what you’d like to grow.' },
        { title: 'Self-compassion', icon: 'heart', more: false, blurb: 'Meeting your own struggles the way you’d meet a friend’s — with honesty and warmth.' },
        { title: 'Boundaries & repair', icon: 'self', more: false, blurb: 'Learning to stay connected to yourself, so you can stay connected to others without disappearing.' },
      ],
    },
    {
      type: 'callout',
      heading: 'Ready to widen the circle?',
      body: 'When you’ve found a little more ground under your own feet, “us” is where it goes next.',
      ctas: [{ label: 'Explore “Us”', href: S('programs/us'), kind: 'primary', icon: 'two' }],
    },
  ],
},

// 4 · US
{
  segments: S('programs/us'),
  hero: 'programs/us',
  kicker: 'Programs · Us', kickerIcon: 'two',
  title: '“Us” is something you do, not something you have.',
  lede: 'Relationship is a practice. Us is for two people — partners, friends, family, colleagues — learning to stay connected through the hard parts, and to repair when connection frays.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'The good news from the field is plain: you can get better at this. Staying close under tension, hearing the other person without abandoning yourself, naming a rupture and mending it — these are learnable skills, not personality types. They just need somewhere to be practised, and someone to practise with.',
        'In a Humanity Centre, “us” often means sitting together in a circle, passing a talking piece, speaking and listening from the heart. One person speaks; everyone else listens. It’s an old, simple form — and it changes how people meet.',
      ],
    },
    {
      type: 'cards', eyebrow: 'What it can look like', icon: 'circle', two: true,
      cards: [
        { title: 'Listening that lands', icon: 'people', more: false, blurb: 'Practising the kind of attention where the other person actually feels heard — the rarest gift.' },
        { title: 'Staying through tension', icon: 'two', more: false, blurb: 'Learning to remain in connection when it’s uncomfortable, instead of fleeing or fighting.' },
        { title: 'Repair', icon: 'hands', more: false, blurb: 'Naming when something’s broken between you, and mending it — the skill that keeps relationships alive.' },
        { title: 'Dyads & circles', icon: 'circle', more: false, blurb: 'Simple, structured practice — a talking piece, shared agreements, real conversation.' },
      ],
    },
    {
      type: 'quote',
      text: 'Pass the talking piece. When it’s yours, speak from the heart. When it isn’t, listen from the heart. That’s the practice.',
      cite: 'Circle practice carries deep Indigenous and First Nations roots — we come to it as students, with respect.',
    },
    {
      type: 'callout',
      heading: 'From two, to many.',
      body: 'What two people learn together, a whole community can learn to hold. That’s “all of us.”',
      ctas: [{ label: 'Explore “All of us”', href: S('programs/all-of-us'), kind: 'primary', icon: 'people' }],
    },
  ],
},

// 5 · ALL OF US
{
  segments: S('programs/all-of-us'),
  hero: 'programs/all-of-us',
  kicker: 'Programs · All of us', kickerIcon: 'people',
  title: 'Belonging, built on purpose.',
  lede: 'The widest circle. All of us is where relating well becomes a way a whole community holds each other — neighbours, strangers, generations, all practising the same thing in the same place.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
'Social neuroscience suggests we’re wired for connection — that the need to belong runs nearly as deep as the need for food or water. Yet belonging rarely just happens; it’s something a community builds, on purpose, in a real place. “All of us” is the work of making a room where the regular and the newcomer, the settled and the searching, all have a seat.',
        'In practice it’s shared meals where you can’t tell who’s paying full price and who isn’t; circles open to the whole street; seasonal gatherings that mark time together. The aim isn’t a perfect community — it’s a community that keeps choosing each other.',
      ],
    },
    {
      type: 'cards', eyebrow: 'What it can look like', icon: 'hex', two: true,
      cards: [
        { title: 'Shared tables', icon: 'gift', more: false, blurb: 'Meals where everyone’s welcome and no one is singled out for what they can give.' },
        { title: 'Open circles', icon: 'circle', more: false, blurb: 'Gatherings the whole neighbourhood can walk into — every voice heard, every seat equal.' },
        { title: 'Marking time together', icon: 'star', more: false, blurb: 'Seasons, milestones, griefs and celebrations — held in company instead of alone.' },
        { title: 'Welcoming newcomers', icon: 'hands', more: false, blurb: 'A community that turns toward the person who just walked in, and is glad they did.' },
      ],
    },
    {
      type: 'callout',
      heading: 'A community needs a place to gather.',
      body: 'All three circles need somewhere to happen. See the kinds of places we’re building, and where.',
      ctas: [
        { label: 'See the places', href: S('places'), kind: 'primary', icon: 'pin' },
        { label: 'Who comes', href: S('participants'), kind: 'ghost', icon: 'people' },
      ],
    },
  ],
},

// ─────────────────────────────────────────────────────────────────────
// 6 · THE PURSE
// ─────────────────────────────────────────────────────────────────────
{
  segments: S('purse'),
  hero: 'purse',
  kicker: 'The Purse', kickerIcon: 'purse',
  title: 'Solidarity, not charity.',
  lede: 'The Purse is a shared fund we tend together. What comes in — gifts, programme contributions, support from across the network — is pooled, and sent back out to the centres and people who need it. So that being helped and helping flow in the same circle.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'A handout creates a giver and a receiver. A shared purse creates neighbours. The idea is old and simple: keep a common fund, so that no one has to practise being human alone — and so the door stays open regardless of what anyone can pay.',
        'We’re an emerging organisation, and we’d rather show you the plan honestly than promise numbers we don’t yet have. Here’s how the fund is designed to move.',
      ],
    },
    {
      type: 'steps',
      eyebrow: 'How it moves', icon: 'flow',
      heading: 'Money in, shared, sent on',
      steps: [
        { title: 'It fills', body: 'Gifts and programme contributions come in on a pay-what-you-can basis — pay the suggested amount, pay what you can, or pay it forward for someone else. No means-testing, no singling anyone out.' },
        { title: 'It pools', body: 'Contributions gather in one shared fund across the Humanity Centres network. When one centre is strong, it strengthens the pool; when another is just starting out, the pool is there.' },
        { title: 'It goes where it’s needed', body: 'The fund travels back out to keep centres open and welcomes flowing — distributed to where it does the most good. As real figures exist, we’ll show exactly how it moved.' },
      ],
    },
    {
      type: 'features',
      items: [
        { img: 'purse/money-from-hc-network', title: 'A network that carries the fund', body: 'No single centre stands alone. Contributions move through the whole network like light along a thread — help received in one place becomes help offered in another. That’s reciprocity, not charity: pay-it-forward as the way the fund renews itself.' },
        { img: 'purse/distribution-to-hcs', title: 'Back out, to keep doors open', body: 'The point of pooling is sharing. The Purse exists so that a centre never has to turn someone away for inability to pay, and so a new centre can find its feet. This is how relating well becomes material — relating well includes how we share what we have.' },
      ],
    },
    {
      type: 'prose',
      eyebrow: 'An honest note', icon: 'spark',
      heading: 'What we’re not claiming',
      paras: [
        'Humanity Centres is a not-for-profit in formation. We are not yet describing ourselves as a registered charity, and nothing here should be read as a promise of tax receipts or audited financials — those come later, named plainly when they’re real. If you give today, you’re helping shape something at the beginning, and we’ll be transparent about every step.',
      ],
    },
    {
      type: 'callout',
      heading: 'Help keep a door open.',
      body: 'Your support helps us build the first centres and the fund that sustains them. Reach out and we’ll tell you exactly where it goes.',
      ctas: [
        { label: 'Get in touch about giving', href: 'mailto:hello@humanitycentres.org', kind: 'primary', icon: 'heart' },
        { label: 'See where we’re rooted', href: S('places/locations'), kind: 'ghost', icon: 'globe' },
      ],
    },
  ],
},

// ─────────────────────────────────────────────────────────────────────
// 7 · WHO COMES
// ─────────────────────────────────────────────────────────────────────
{
  segments: S('participants'),
  hero: 'participants/location',
  kicker: 'Who comes', kickerIcon: 'people',
  title: 'You don’t have to arrive as anything in particular.',
  lede: 'Just come as a human. Humanity Centres are low-barrier by design — no membership, no cover charge, no need to be in crisis or to have it all together. A chair pulled up, a kettle on, a door that’s actually open.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'A good gathering place doesn’t sort people into deserving and undeserving. It makes room. Whoever you are, wherever you’re coming from, whatever you can give — there’s a seat. These four simple questions are all we ever really need to meet you well.',
      ],
    },
    {
      type: 'cards', eyebrow: 'Coming as you are', icon: 'circle',
      heading: 'Four ways in',
      cards: [
        { title: 'Wherever you are', img: 'participants/location', icon: 'pin', tag: 'location', blurb: 'Come from down the street or across the world. Each centre is rooted in its own place — and the welcome travels.' },
        { title: 'Whatever fits', img: 'participants/program', icon: 'compass', tag: 'programme', blurb: 'Me, us, or all of us — begin in the circle that meets where you are right now.' },
        { title: 'Whoever you are', img: 'participants/type', icon: 'star', tag: 'every kind of person', blurb: 'Settled or searching, regular or first-timer, every background and belief — all are welcome here.' },
        { title: 'Whatever you can give', img: 'participants/payment', icon: 'gift', tag: 'payment', blurb: 'Pay what you can, pay it forward, or lend a hand. At our tables, you can’t tell who paid full price — and that’s the whole idea.' },
      ],
    },
    {
      type: 'quote',
      text: 'Belonging isn’t a programme you sign up for. It’s what happens when there’s a place to come back to, and someone glad you did.',
    },
    {
      type: 'callout',
      heading: 'Find a place near you — or further afield.',
      body: 'We’re rooted in British Columbia, with horizons we’re dreaming toward. See where Humanity Centres are taking shape.',
      ctas: [{ label: 'Where we are', href: S('places/locations'), kind: 'primary', icon: 'globe' }],
    },
  ],
},

// ─────────────────────────────────────────────────────────────────────
// 8 · PLACES
// ─────────────────────────────────────────────────────────────────────
{
  segments: S('places'),
  hero: 'places/types/neighbourhood-houses',
  kicker: 'Places', kickerIcon: 'pin',
  title: 'Different doors into the same welcome.',
  lede: 'A retreat centre on a quiet lake, a neighbourhood house on your block, a storefront on the high street. Three kinds of place, one ethos: somewhere you belong before you’re asked to be anything.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'Belonging is something a place can hold. The right room, the right table, the right circle of chairs changes what’s possible between people. Humanity Centres take three forms — each a different way into the same kind of welcome — and each shaped by where it stands and who it serves.',
      ],
    },
    {
      type: 'cards', eyebrow: 'Explore', icon: 'hex',
      heading: 'Three ways to look at a place',
      cards: [
        { title: 'Kinds of place', href: S('places/types'), img: 'places/types/storefronts/circles-in-the-square', icon: 'home', blurb: 'Retreat centres, neighbourhood houses, and storefronts — the three forms a Humanity Centre can take.' },
        { title: 'Where we are', href: S('places/locations'), img: 'places/locations/canada', icon: 'globe', blurb: 'Rooted in British Columbia, with horizons in Quebec, Ontario, and further afield.' },
        { title: 'What makes a centre', href: S('places/qualities'), img: 'places/qualities/other-facilities', icon: 'bed', blurb: 'Rooms to stay, space to gather, a table to share — the texture of a place built for being human.' },
      ],
    },
    {
      type: 'callout',
      heading: 'Could your place be one?',
      body: 'A spare hall, a quiet retreat, an empty shopfront — many places can become a Humanity Centre. If you steward a space and the idea resonates, we’d love to hear from you.',
      ctas: [{ label: 'Talk to us about hosting', href: 'mailto:hello@humanitycentres.org', kind: 'primary', icon: 'home' }],
    },
  ],
},

// 9 · WHERE WE ARE
{
  segments: S('places/locations'),
  hero: 'places/locations/canada',
  kicker: 'Places · Where we are', kickerIcon: 'globe',
  title: 'Rooted here, reaching wider.',
  lede: 'Humanity Centres begins in Canada — most concretely on the West Coast — with an open hope to grow the network over time. We’d rather name where we honestly stand than draw a map we haven’t earned.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'Our roots are in British Columbia, on Vancouver Island and around the Lower Mainland, with the wider network taking shape across Canada — in Quebec and Ontario — and horizons we’re dreaming toward beyond. Switzerland and Bermuda are not places we have arrived; they’re hopes on the edge of the map. We’ll tell you when that changes.',
      ],
    },
    {
      type: 'chips',
      eyebrow: 'Canada', icon: 'pin',
      heading: 'Where the work is closest to the ground',
      intro: 'In British Columbia especially, the kinds of places this vision points toward already exist — and we’re learning from them.',
      chips: [
        { label: 'British Columbia', icon: 'leaf' },
        { label: 'Quebec', icon: 'pin' },
        { label: 'Ontario', icon: 'pin' },
      ],
    },
    {
      type: 'features',
      items: [
        { img: 'places/qualities/other-facilities', title: 'Vancouver Island — Nanaimo', body: 'On the shore of Westwood Lake, the independent <a href="' + EXT.bethlehem + '" target="_blank" rel="noopener">Bethlehem Centre</a> shows what a mature retreat-centre looks like. We name it as inspiration, not affiliation. These are the traditional, ancestral, and unceded territories of the Coast Salish peoples — specifically the Snuneymuxw First Nation.' },
        { img: 'places/types/neighbourhood-houses', title: 'The Lower Mainland — Surrey & Vancouver', body: 'Across Surrey and Vancouver’s South False Creek, neighbourhood houses keep “community living rooms” open for everyone. Surrey sits on the shared territories of the Semiahmoo, Katzie, and Kwantlen Nations; South False Creek on the unceded territories of the Musqueam, Squamish, and Tsleil-Waututh.' },
        { img: 'places/locations/bermuda', title: 'Horizons abroad', body: 'Switzerland and Bermuda are early hopes, not operations — horizons that remind us the work isn’t bound to one coast. An emerging international vision, honestly told: real places taking shape here, and an open invitation to grow it wider.' },
      ],
    },
    {
      type: 'prose',
      eyebrow: 'With gratitude and responsibility', icon: 'leaf',
      heading: 'Whose land each centre stands on',
      paras: [
        'Before we talk about belonging, we honour those who have belonged here since time immemorial. Each centre carries the name of the Nation whose land it sits on — not as a formality, but as the first relationship we tend. These acknowledgements are drawn from authoritative public sources and the Nations’ own words, and we hold them as the start of relationship and action, not a substitute for it.',
      ],
    },
  ],
},

// 10 · WHAT MAKES A CENTRE
{
  segments: S('places/qualities'),
  hero: 'places/qualities/other-facilities',
  kicker: 'Places · What makes a centre', kickerIcon: 'bed',
  title: 'The texture of a place built for being human.',
  lede: 'Rooms to stay the night. Space to gather in many sizes. A table to share, a garden to tend, a quiet corner to think. The qualities of a centre are simple — and they matter more than they look.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'What turns a building into a place of belonging isn’t grandeur — it’s thoughtfulness. Enough beds that people can stay long enough to soften. Rooms that fit a pair, a circle, and a crowd. A kitchen that can feed everyone at once. And the small touches — a labyrinth, a library, a garden — that invite you to slow down.',
      ],
    },
    {
      type: 'cards', eyebrow: 'The qualities we look for', icon: 'hex', two: true,
      cards: [
        { title: 'Room specifications', icon: 'bed', more: false, blurb: 'Places to stay overnight — so a retreat can last more than an afternoon, and people can arrive from far away.' },
        { title: 'Numbers of participants', icon: 'people', more: false, blurb: 'Spaces that fit a quiet dyad, a circle of a dozen, and a shared meal for the whole room.' },
        { title: 'Other facilities', icon: 'leaf', more: false, blurb: 'The gentle extras — a garden, a labyrinth, a library, a fire — that make a place worth returning to.' },
      ],
    },
    {
      type: 'stats',
      heading: 'What a mature centre can look like',
      intro: 'For a sense of scale, take the independent <a href="' + EXT.bethlehem + '" target="_blank" rel="noopener">Bethlehem Centre</a> in Nanaimo — an established retreat centre we admire (and are not affiliated with). By its own account:',
      stats: [
        { value: '4', label: 'guesthouses, with around 37 rooms to stay in' },
        { value: '7', label: 'distinct gathering venues for circles big and small' },
        { value: '~50', label: 'seats at the table for a shared meal' },
        { value: '1', label: 'Chartres-style labyrinth to walk inward, plus a garden, library, and reflective pond' },
      ],
    },
    {
      type: 'prose',
      paras: [
        'Figures above describe Bethlehem Centre, quoted from its own site — an illustration of the form, not a claim about our own facilities. Most Humanity Centres will start smaller and grow into themselves.',
      ],
      tight: true,
    },
    {
      type: 'callout',
      heading: 'See the three kinds of place.',
      body: 'Retreat centres aren’t the only door. Neighbourhood houses and storefronts open the same welcome in different ways.',
      ctas: [{ label: 'Kinds of place', href: S('places/types'), kind: 'primary', icon: 'home' }],
    },
  ],
},

// 11 · KINDS OF PLACE
{
  segments: S('places/types'),
  hero: 'places/types/storefronts/circles-in-the-square',
  kicker: 'Places · Kinds of place', kickerIcon: 'home',
  title: 'Three forms, one welcome.',
  lede: 'A Humanity Centre can take the shape of a retreat by a lake, a neighbourhood house on a residential street, or a storefront in the middle of everyday life. Each meets people differently — and they add up to a network with many front doors.',
  sections: [
    {
      type: 'cards', eyebrow: 'The three forms', icon: 'hex',
      heading: 'Pick the door that fits',
      cards: [
        { title: 'Retreat centres', href: S('places/types/retreat-centres'), img: 'places/qualities/other-facilities', icon: 'moon', tag: 'go deep', blurb: 'Stay a while. Quiet, nature, room to walk inward and come back changed.' },
        { title: 'Neighbourhood houses', href: S('places/types/neighbourhood-houses'), img: 'places/types/neighbourhood-houses', icon: 'home', tag: 'belong locally', blurb: 'A community living room on your own street — open to the whole neighbourhood, holding the whole person.' },
        { title: 'Storefronts', href: S('places/types/storefronts'), img: 'places/types/storefronts/circles-in-the-square', icon: 'store', tag: 'walk right in', blurb: 'A third place on the high street, lit from within — no invitation needed. We gather in circles.' },
      ],
    },
    {
      type: 'quote',
      text: 'A retreat centre, a neighbourhood house, a storefront on your street — different doors into the same welcome.',
    },
  ],
},

// 12 · RETREAT CENTRES
{
  segments: S('places/types/retreat-centres'),
  hero: 'places/qualities/other-facilities',
  kicker: 'Places · Retreat centres', kickerIcon: 'moon',
  title: 'Stay a while. Come back changed.',
  lede: 'Some of the deepest relational work needs more than an afternoon. Retreat centres offer time and quiet — somewhere to stay overnight, walk in nature, sit in long circles, and let the noise settle.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'A retreat is a change of pace as much as a change of place. Away from the rush, with a bed to sleep in and a table to gather around, people can do the slower work: meeting themselves honestly, mending what’s frayed with someone they love, learning to belong to a group over days rather than minutes.',
      ],
    },
    {
      type: 'features',
      items: [
        { img: 'places/qualities/other-facilities', title: 'An example we admire — honestly named', body: 'In Nanaimo, on the shore of Westwood Lake at the foot of Mount Benson, the independent <a href="' + EXT.bethlehem + '" target="_blank" rel="noopener">Bethlehem Centre</a> has welcomed people for decades. It describes its vision as “spirituality without borders,” and itself as “a place where all people can come together to learn, heal, and grow.” Those are its words, not ours — and it is its own organisation, with no affiliation to Humanity Centres. We point to it because it already does, beautifully, what we mean by a retreat centre.', moreLabel: 'Visit Bethlehem Centre', href: EXT.bethlehem },
      ],
    },
    {
      type: 'cards', eyebrow: 'What a retreat offers', icon: 'leaf', two: true,
      cards: [
        { title: 'Time to stay', icon: 'bed', more: false, blurb: 'Overnight rooms, so the work can unfold over days — long enough for something to shift.' },
        { title: 'Quiet and nature', icon: 'leaf', more: false, blurb: 'Forest, water, a garden, a labyrinth — surroundings that help you slow down and listen.' },
        { title: 'Long-form circles', icon: 'circle', more: false, blurb: 'Sustained practice in company — not a single session, but a rhythm you settle into.' },
      ],
    },
    {
      type: 'prose',
      paras: ['These are the traditional, ancestral, and unceded territories of the Coast Salish peoples — on Vancouver Island, specifically the Snuneymuxw First Nation. We name whose land we stand on as the first relationship we tend.'],
      tight: true,
    },
  ],
},

// 13 · NEIGHBOURHOOD HOUSES
{
  segments: S('places/types/neighbourhood-houses'),
  hero: 'places/types/neighbourhood-houses',
  kicker: 'Places · Neighbourhood houses', kickerIcon: 'home',
  title: 'A community living room on your own street.',
  lede: 'The neighbourhood-house tradition is more than a century old: place-based, multi-service hubs where people connect, learn, and belong. We’re learning from it — humbly, and in our own words.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'The <a href="' + EXT.anhbc + '" target="_blank" rel="noopener">neighbourhood-house movement</a> describes each house as a “community living room — a place where everyone belongs,” caring for the whole person, the whole family, the whole neighbourhood, and the whole community. That phrase, and that century of practice, belong to the movement — not to us. We name them with respect, as the tradition a Humanity Centre stands in.',
        'What we take from it is an ethos: a neighbourhood house isn’t there to be the solution for people — it’s there to offer the room, the relationships, and the support so a community can grow its own way forward. Belonging first; everything else follows.',
      ],
    },
    {
      type: 'cards', eyebrow: 'The ethos we share', icon: 'hex', two: true,
      cards: [
        { title: 'Everyone belongs', icon: 'people', more: false, blurb: 'A door open to the whole neighbourhood — every age, background, and belief, no membership required.' },
        { title: 'The whole person', icon: 'heart', more: false, blurb: 'Meeting people as whole humans in whole families and neighbourhoods, not as a single need to be processed.' },
        { title: 'Empowerment, not rescue', icon: 'hands', more: false, blurb: 'Offering tools, knowledge, and real support — helping people find their own way, not being the answer for them.' },
        { title: 'Rooted in place', icon: 'pin', more: false, blurb: 'Shaped by the actual street it sits on, responding to what this community actually needs.' },
      ],
    },
    {
      type: 'quote',
      text: 'A place to take off your coat, sit down, and be met — somewhere you belong before you’re asked to be anything.',
      cite: 'In the spirit of the neighbourhood-house tradition',
    },
  ],
},

// 14 · STOREFRONTS
{
  segments: S('places/types/storefronts'),
  hero: 'places/types/storefronts/circles-in-the-square',
  kicker: 'Places · Storefronts', kickerIcon: 'store',
  title: 'A door that’s actually open.',
  lede: 'A storefront on the high street, lit from within — the kind of place you can walk into on an ordinary Tuesday and not leave a stranger. No invitation, no membership, no cover charge. Just a chair pulled up and a kettle on.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'Ray Oldenburg called them <a href="' + EXT.thirdplace + '" target="_blank" rel="noopener">“third places”</a> — the spots that aren’t home and aren’t work, where community actually happens: neutral ground, status left at the door, conversation as the main event. A storefront puts that welcome at street level, where anyone can find it.',
        'Many will run on a pay-what-you-can spirit: pay the suggested amount, pay what you can, pay it forward, or lend a hand — an idea reputable community cafés like <a href="' + EXT.pwyc + '" target="_blank" rel="noopener">One World Everybody Eats</a> have shown can work. The point isn’t the price of the cup. It’s that no one is turned away, and you can’t tell who paid what.',
      ],
    },
    {
      type: 'features',
      items: [
        { img: 'places/types/storefronts/circles-in-the-square', title: 'Circles in the Square', body: 'Our name for the storefront idea: a circle of people, a storefront on the square, in the middle of everyday life. We gather in circles because a circle has no head of the table — every seat is equal, every voice is heard. Circle and council practice is older than any of us, carried for generations by First Nations and many peoples; we come to it as students, with respect.' },
      ],
    },
    {
      type: 'cards', eyebrow: 'What makes a storefront work', icon: 'circle', two: true,
      cards: [
        { title: 'Low barrier', icon: 'store', more: false, blurb: 'Ground-level, walk-in, visible from the street. No membership, no gatekeeping — just an open door.' },
        { title: 'A third place', icon: 'home', more: false, blurb: 'Not home, not work — neutral ground where you’re known by name and welcome to simply be.' },
        { title: 'Pay what you can', icon: 'gift', more: false, blurb: 'Pay the suggested amount, pay what you can, or pay it forward. No one eats or sits alone for lack of means.' },
        { title: 'Gather in circles', icon: 'circle', more: false, blurb: 'A talking piece, shared agreements, speaking and listening from the heart — every voice in the round.' },
      ],
    },
    {
      type: 'callout',
      heading: 'Know an empty shopfront with good light?',
      body: 'Storefronts are the easiest kind of centre to start. If you have a space, a street, or an idea, let’s talk.',
      ctas: [{ label: 'Start a storefront', href: 'mailto:hello@humanitycentres.org', kind: 'primary', icon: 'store' }],
    },
  ],
},

// ─────────────────────────────────────────────────────────────────────
// 15 · PRACTITIONERS
// ─────────────────────────────────────────────────────────────────────
{
  segments: S('practitioners'),
  hero: 'practitioners/location',
  kicker: 'Practitioners', kickerIcon: 'hands',
  title: 'The people who hold the room.',
  lede: 'A welcome doesn’t run itself. Practitioners are the people who tend the space, hold the circle, and make the welcome real — facilitators, hosts, and guides who’ve practised relating well enough to help others practise too.',
  sections: [
    {
      type: 'prose', lead: true,
      paras: [
        'Holding a good circle is a craft. It takes someone who can keep a space safe without controlling it, who can listen for what’s underneath, who can let silence do its work and step in when repair is needed. Our practitioners come from many backgrounds — facilitation, care, counselling, community work, the contemplative traditions — united by a practice of presence.',
        'We’re gathering this circle of practitioners now, beginning on the West Coast. If holding space is your work or your calling, we’d love to meet you.',
      ],
    },
    {
      type: 'chips',
      eyebrow: 'Where our first practitioners are based', icon: 'pin',
      heading: 'Rooted on the West Coast',
      intro: 'The first practitioners are taking root around British Columbia. Each place sits on the territory of the Nations who have cared for it since time immemorial.',
      chips: [
        { label: 'Surrey, BC', icon: 'pin' },
        { label: 'Nanaimo, BC', icon: 'pin' },
        { label: 'South False Creek, Vancouver, BC', icon: 'pin' },
      ],
    },
    {
      type: 'cards', eyebrow: 'What a practitioner brings', icon: 'hex', two: true,
      cards: [
        { title: 'Presence', icon: 'self', more: false, blurb: 'The ability to be genuinely with people — grounded, unhurried, and real.' },
        { title: 'Holding the circle', icon: 'circle', more: false, blurb: 'Keeping a space safe and alive: shared agreements, every voice heard, no one steamrolled.' },
        { title: 'Skill in repair', icon: 'hands', more: false, blurb: 'Helping people name ruptures and mend them — the heart of relational practice.' },
        { title: 'Humility', icon: 'leaf', more: false, blurb: 'A practitioner is a guide, not a guru. The community is the hero; we just hold the room.' },
      ],
    },
    {
      type: 'callout',
      heading: 'Do you hold space for a living — or a calling?',
      body: 'We’re building the first circle of Humanity Centres practitioners. If this is your work, come help shape how it’s done.',
      ctas: [
        { label: 'Introduce yourself', href: 'mailto:hello@humanitycentres.org', kind: 'primary', icon: 'hands' },
        { label: 'Back to the start', href: S(''), kind: 'ghost', icon: 'home' },
      ],
    },
  ],
},

]

module.exports = { PAGES, LABELS }
