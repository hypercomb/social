// Build Dolphin's reorganized hive — 8 top-level domains with substantive
// notes per tile describing his interests in that area. Two-phase commit:
// (1) tile structure via `update` ops, (2) notes via `note-add` ops.
//
// Notes are authored as participant layers through NotesService — same
// path user-typed notes take, fully merkle-correct, picked up by the
// notes-strip on selection.

import { send } from '../hypercomb-cli/src/bridge/client.js'

interface HiveTile {
  name: string
  notes?: string[]
  children?: HiveTile[]
}

const HIVE: HiveTile = {
  name: 'root',
  notes: [
    'Dolphin\'s Relational Intelligence platform — coaching, certifications, live events, and a co-created community of practice.',
    'The intelligence of life that enables any relationship — and the parts within it — to be more than the sum of their parts.',
  ],
  children: [
    {
      name: 'model',
      notes: [
        'The conceptual core: vision, philosophy, the four pillars, and the relational capacities that develop them.',
        'Dolphin\'s thesis: relating well isn\'t a personality trait — it\'s an intelligence that can be named, taught, and practiced.',
      ],
      children: [
        {
          name: 'pillars',
          notes: [
            'Grounded: feeling at home in your body and the present moment, the foundation for all relating.',
            'Present: undivided attention without agenda, the doorway to authentic connection.',
            'Connected: experiencing the field between people as alive and informative.',
            'Fulfilled: meeting of essence between two differentiated humans.',
          ],
        },
        {
          name: 'capacities',
          notes: [
            'Attunement: noticing what someone else is actually experiencing, beyond what they\'re saying.',
            'Repair: closing the loop after a rupture without making it worse.',
            'Co-regulation: bringing each other back to a settled nervous system together.',
            'Differentiation: staying yourself while staying close.',
            'Secure relating: trustworthy, low-defended, willing to be known.',
            'Emotional fluency: naming feelings precisely enough that they move through.',
            'Relational courage: saying the true thing when it costs something.',
          ],
        },
        {
          name: 'frameworks',
          notes: [
            'Relational field theory: the space between two people is itself an entity worth attending to.',
            'Developmental stages: relational capacity grows in identifiable phases, like motor skills.',
            'Assessment tools: ways to see where someone is on the developmental arc.',
          ],
        },
        {
          name: 'intellectual-property',
          notes: [
            'Trademarked methodologies, curricula, publications — what makes the work transmissible and protected.',
            'Dolphin\'s long arc: build IP that can outlive the founder and license cleanly.',
          ],
        },
      ],
    },
    {
      name: 'practice',
      notes: [
        'How the model becomes lived experience: programs, events, trainings, certification.',
        'The bridge from idea to embodied skill — where audiences actually meet the work.',
      ],
      children: [
        {
          name: 'live',
          notes: [
            'Talks, keynotes, workshops, retreats, multi-day immersions — high-bandwidth in-person work.',
            'Where transformation happens fastest: a room, a weekend, presence itself as the curriculum.',
          ],
        },
        {
          name: 'online',
          notes: [
            'Evergreen courses for the self-paced learner; cohort programs for those who need accountability and community.',
            'Memberships and masterminds for ongoing practice — relational fitness needs reps over time.',
          ],
        },
        {
          name: 'certification',
          notes: [
            'Levels 1–4: Foundations → Practitioner → Master → Trainer. A real pathway, not just a course.',
            'Ethics and standards: what it means to hold this work responsibly with another human.',
            'Dolphin\'s vision: a global guild of certified RI practitioners.',
          ],
        },
      ],
    },
    {
      name: 'audience',
      notes: [
        'Who this is for: from individuals seeking depth to organizations building healthier cultures.',
        'Each segment shows up with different presenting concerns but the underlying skill is the same.',
      ],
      children: [
        {
          name: 'individuals',
          notes: [
            'Personal-growth seekers, people in transition, parents, men and women in their own developmental work.',
            'Often arrive via a relationship rupture and stay for the larger transformation.',
          ],
        },
        {
          name: 'couples',
          notes: [
            'In conflict, seeking depth, engaged, new parents, long-term partners — every stage has its work.',
            'The couple is the most common laboratory for relational capacity.',
          ],
        },
        {
          name: 'professionals',
          notes: [
            'Coaches, therapists, counselors, facilitators, consultants, HR leaders, educators, healthcare providers.',
            'They take RI back into their own practice and multiply impact.',
          ],
        },
        {
          name: 'organizations',
          notes: [
            'Corporate teams, startups, nonprofits, schools, healthcare systems — relational health as organizational health.',
            'The leverage point: leaders who relate well change how thousands work together.',
          ],
        },
        {
          name: 'communities',
          notes: [
            'Men\'s groups, women\'s circles, parenting communities, recovery, spiritual, professional networks.',
            'Where relational practice gets normalized — peer-led, no therapist required.',
          ],
        },
      ],
    },
    {
      name: 'network',
      notes: [
        'The people around the work: collaborators in the field, community members, governance structures.',
        'Dolphin builds with peers — RI is co-created, not solo.',
      ],
      children: [
        {
          name: 'collaborators',
          notes: [
            'Relational science core: Terry Real, the Gottmans, Esther Perel, Daniel Siegel, Julie Menanno.',
            'Attachment specialists: Sue Johnson, Stan Tatkin, Thais Gibson, Diane Poole Heller.',
            'Neuroscience bridge: Andrew Huberman, Joe Dispenza.',
            'Trauma & healing: Gabor Maté, Peter Crone, Becky Kennedy.',
            'Wisdom & philosophy: Alain de Botton, Jordan Peterson, Yung Pueblo.',
            'Mass-reach distribution: Simon Sinek, Steven Bartlett, Mel Robbins, Brené Brown.',
            'Platform builders: Sabri Suby, Dan Martell, Alex Hormozi, Chris Do.',
          ],
        },
        {
          name: 'roles',
          notes: [
            'Founding circle, advisory board, core contributors, certified practitioners, champions, fellows.',
            'Clear roles let people step into what fits — no gatekeeping, no ambiguity.',
          ],
        },
        {
          name: 'governance',
          notes: [
            'Decision-making process, community agreements, conflict resolution, transparency practices.',
            'A relational platform must demonstrate relational governance — practice what it teaches.',
          ],
        },
        {
          name: 'engagement',
          notes: [
            'Onboarding journey, recognition, milestone celebrations, annual gathering.',
            'Belonging is built through repeated rituals, not just access.',
          ],
        },
      ],
    },
    {
      name: 'business',
      notes: [
        'How RI sustains itself as a business: brand, operations, marketing, sales, client experience, growth phasing.',
        'The discipline of running it well so the work can keep showing up.',
      ],
      children: [
        {
          name: 'brand',
          notes: [
            'Identity, voice, visual identity, story, positioning, media kit.',
            'Premium without being precious; warm without being soft.',
          ],
        },
        {
          name: 'operations',
          notes: [
            'Team, systems & tools, finance, legal, project management, SOPs.',
            'Boring well-run plumbing is what lets the magic show up reliably.',
          ],
        },
        {
          name: 'marketing',
          notes: [
            'Content strategy, social, email, podcast, YouTube, SEO, partnerships, PR, paid, funnels.',
            'Educate first; the right people self-select in.',
          ],
        },
        {
          name: 'sales',
          notes: [
            'Process, discovery calls, proposals, pricing strategy, CRM, pipeline.',
            'Sell with the same presence the work teaches — no manipulation.',
          ],
        },
        {
          name: 'client-experience',
          notes: [
            'Onboarding, delivery, support, feedback loops, testimonials, case studies, alumni network.',
            'The relationship after the program is as important as the program itself.',
          ],
        },
        {
          name: 'phases',
          notes: [
            'Phase 1 — Foundation: build the curriculum, brand, signature program, founding cohort.',
            'Phase 2 — Traction: certification launch, evergreen funnels, podcast, speaking circuit.',
            'Phase 3 — Scale: platform build, licensee network, corporate division, international expansion.',
            'Phase 4 — Movement: nonprofit arm, policy influence, academic integration, publishing house.',
          ],
        },
      ],
    },
    {
      name: 'platform',
      notes: [
        'The tech infrastructure that hosts the practice — learning environment, community hub, practitioner tools, AI, integrations.',
        'A future-proof platform where target audiences find everything they need.',
      ],
      children: [
        {
          name: 'learning',
          notes: [
            'Course delivery, live sessions, forums, resource library, progress tracking, peer matching.',
            'Designed for practice repetition, not just content consumption.',
          ],
        },
        {
          name: 'community-hub',
          notes: [
            'Member profiles, discussion spaces, events calendar, mentorship matching, project spaces.',
            'Where the network does its own work between live touches.',
          ],
        },
        {
          name: 'practitioner-tools',
          notes: [
            'Client management, session notes, assessment delivery, progress dashboards, supervision tools.',
            'Equip certified practitioners to run real practices, not just have credentials.',
          ],
        },
        {
          name: 'ai-automation',
          notes: [
            'Relational AI companion, practice prompts, journaling assistant, matching algorithms, analytics.',
            'AI as scaffolding for human practice, never as replacement.',
          ],
        },
        {
          name: 'integrations',
          notes: [
            'Calendar, payments, email, video conferencing, CRM, social APIs.',
            'Plumbing — invisible when it works, blocking when it doesn\'t.',
          ],
        },
      ],
    },
    {
      name: 'voice',
      notes: [
        'Outward expression: podcast, writing, video, social, resources.',
        'How the work reaches people who haven\'t found it yet.',
      ],
      children: [
        {
          name: 'podcast',
          notes: [
            'The Relational Intelligence Podcast — long-form conversations with collaborators in the field.',
            'Episode archive, guest pipeline, production rhythm.',
          ],
        },
        {
          name: 'writing',
          notes: [
            'Book manuscript, articles, newsletter, white papers, case studies.',
            'The book is the anchor — once it exists, everything else points to it.',
          ],
        },
        {
          name: 'video',
          notes: [
            'YouTube channel, course videos, social clips, documentary project, live streams.',
            'Show the work in action — modeling teaches faster than telling.',
          ],
        },
        {
          name: 'social',
          notes: [
            'Instagram, LinkedIn, TikTok, Twitter/X, Facebook, Threads.',
            'Each platform a different audience and rhythm — stop trying to be everywhere identically.',
          ],
        },
        {
          name: 'resources',
          notes: [
            'Worksheets, guided practices, assessment tools, infographics, templates, reading lists.',
            'Free utility that proves the framework works before anyone buys.',
          ],
        },
      ],
    },
    {
      name: 'evidence',
      notes: [
        'The proof: foundational science, applied research, academic partnerships, humanity outcomes, systemic change, legacy.',
        'Without research credibility, RI is opinion. With it, it\'s a field.',
      ],
      children: [
        {
          name: 'foundational-science',
          notes: [
            'Attachment theory, interpersonal neurobiology, polyvagal theory, relational psychoanalysis, positive psychology, complexity science.',
            'Stand on the giants — RI synthesizes existing science into a usable shape.',
          ],
        },
        {
          name: 'applied-research',
          notes: [
            'Program outcomes, practitioner effectiveness, organizational impact, longitudinal studies.',
            'Measure what matters: do people\'s relationships actually get better, lastingly?',
          ],
        },
        {
          name: 'academic-partnerships',
          notes: [
            'University collaborations, research grants, peer-reviewed publications, doctoral projects.',
            'Take the work into the academy so the next generation of researchers can build on it.',
          ],
        },
        {
          name: 'humanity-outcomes',
          notes: [
            'More grounded, more present, more connected, more fulfilled humans.',
            'The actual deliverable — everything else is in service of these.',
          ],
        },
        {
          name: 'systemic-change',
          notes: [
            'Relational education in schools, RI in workplaces, relational health in healthcare, relational literacy in media, relational wisdom in policy.',
            'The long arc: relational capacity becomes part of the public infrastructure, not just private therapy.',
          ],
        },
        {
          name: 'legacy',
          notes: [
            'RI Institute, RI Foundation, open-source curricula, global practitioner guild, intergenerational research.',
            'Build it so that when Dolphin steps back, the work continues at scale and integrity.',
          ],
        },
      ],
    },
  ],
}

interface TileSpec {
  segments: string[]
  name: string
  children: string[]
  notes: string[]
}

function collectTiles(node: HiveTile, segments: string[], out: TileSpec[]): void {
  const childNames = (node.children ?? []).map(c => c.name)
  out.push({
    segments: segments.slice(),
    name: node.name,
    children: childNames,
    notes: node.notes ?? [],
  })
  for (const child of node.children ?? []) {
    collectTiles(child, [...segments, child.name], out)
  }
}

async function main(): Promise<void> {
  const tiles: TileSpec[] = []
  collectTiles(HIVE, [], tiles)

  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[build-hive] phase 1: ${tiles.length} tile structures`)
  console.log(`[build-hive] phase 2: ${totalNotes} notes`)

  // Phase 1: tile structure (children only — no notes in the layer slot,
  // since notes are participant layers committed via NotesService).
  let okStruct = 0
  let failStruct = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const path = t.segments.length === 0 ? '(root)' : t.segments.join('/')
    process.stdout.write(`[struct ${i + 1}/${tiles.length}] ${path} ← ${t.children.length} children ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (t.children.length) layer.children = t.children
    const res = await send({
      op: 'update',
      segments: t.segments,
      layer,
    })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }

  console.log('')
  console.log(`[build-hive] phase 1 complete: ${okStruct} ok, ${failStruct} failed`)
  console.log('')

  // Phase 2: notes via NotesService.addAtSegments through bridge `note-add`.
  // For each tile, parentSegments = tile's parent path, cellLabel = tile name.
  // Top-level tiles (segments=[name]) have parentSegments=[] which would
  // make notes orphan to root — we attach those at the cell itself.
  let okNotes = 0
  let failNotes = 0
  let noteIdx = 0
  for (const t of tiles) {
    if (!t.notes.length) continue
    if (t.segments.length === 0) {
      // root has no parent — its notes attach to the root view itself
      // by treating root as cellLabel='root' under no parent
      for (const text of t.notes) {
        noteIdx++
        const res = await send({ op: 'note-add', segments: [], cell: 'root', text })
        if (res.ok) { okNotes++ }
        else { failNotes++; console.log(`[note ${noteIdx}/${totalNotes}] root ← FAIL: ${res.error}`) }
      }
      continue
    }
    const parentSegments = t.segments.slice(0, -1)
    const cellLabel = t.segments[t.segments.length - 1]
    for (const text of t.notes) {
      noteIdx++
      const path = t.segments.join('/')
      process.stdout.write(`[note ${noteIdx}/${totalNotes}] ${path} ... `)
      const res = await send({
        op: 'note-add',
        segments: parentSegments,
        cell: cellLabel,
        text,
      })
      if (res.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${res.error}`) }
    }
  }

  console.log('')
  console.log(`[build-hive] phase 2 complete: ${okNotes} ok, ${failNotes} failed`)
  console.log('')
  console.log(`[build-hive] DONE — ${okStruct} tiles + ${okNotes} notes`)
}

main().catch(err => { console.error(err); process.exit(1) })
