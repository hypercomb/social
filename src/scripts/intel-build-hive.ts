// Build a reorganized Dolphin hive — 8 top-level domains (vs the 11 in
// seed.js), structurally cleaner, with notes attached on each tile rather
// than separate leaf-tiles for every label. Best-guess initial structure;
// Dolphin can refine content later.
//
// Each tile update goes through bridge `update(layer)` → committer.update —
// merkle-correct, single cascade per parent.

import { send } from '../hypercomb-cli/src/bridge/client.js'

interface HiveTile {
  name: string
  children?: HiveTile[]
  notes?: string[]
}

// 8-domain restructure. Top-level concepts; each with sub-areas as
// child tiles; granular concepts attached as notes (placeholders).
const HIVE: HiveTile = {
  name: 'root',
  children: [
    {
      name: 'model',
      notes: ['vision', 'philosophy', 'core-thesis'],
      children: [
        { name: 'pillars', notes: ['grounded', 'present', 'connected', 'fulfilled'] },
        { name: 'capacities', notes: ['attunement', 'repair', 'co-regulation', 'differentiation', 'secure-relating', 'emotional-fluency', 'relational-courage'] },
        { name: 'frameworks', notes: ['relational-field-theory', 'developmental-stages', 'assessment-tools'] },
        { name: 'intellectual-property', notes: ['methodologies', 'curricula', 'publications', 'trademarks'] },
      ],
    },
    {
      name: 'practice',
      notes: ['live-experiences', 'online-programs', 'certification-pathway'],
      children: [
        { name: 'live', notes: ['talks-keynotes', 'workshops', 'retreats', 'trainings', 'immersions'] },
        { name: 'online', notes: ['evergreen-courses', 'cohort-programs', 'masterminds', 'micro-learning'] },
        { name: 'certification', notes: ['level-1-foundations', 'level-2-practitioner', 'level-3-master', 'level-4-trainer', 'continuing-education', 'ethics-standards'] },
      ],
    },
    {
      name: 'audience',
      notes: ['who-this-is-for', 'segmentation'],
      children: [
        { name: 'individuals', notes: ['personal-growth', 'in-transition', 'singles', 'parents', 'men', 'women'] },
        { name: 'couples', notes: ['conflict', 'depth', 'engaged', 'new-parents', 'long-term'] },
        { name: 'professionals', notes: ['coaches', 'therapists', 'counselors', 'facilitators', 'consultants', 'hr-leaders', 'educators', 'healthcare'] },
        { name: 'organizations', notes: ['corporate', 'startups', 'nonprofits', 'schools', 'healthcare-systems', 'government', 'faith-communities'] },
        { name: 'communities', notes: ['mens-groups', 'womens-circles', 'parenting', 'recovery', 'spiritual', 'professional-networks'] },
      ],
    },
    {
      name: 'network',
      notes: ['the-people-around-the-work'],
      children: [
        { name: 'collaborators', notes: ['relational-science', 'attachment', 'neuroscience', 'communication', 'wisdom', 'mass-reach', 'trauma-healing', 'platform-builders'] },
        { name: 'roles', notes: ['founding-circle', 'advisory-board', 'core-contributors', 'practitioners', 'champions', 'fellows', 'creators', 'hosts', 'ambassadors'] },
        { name: 'governance', notes: ['decision-making', 'agreements', 'conflict-resolution', 'feedback-mechanisms', 'transparency'] },
        { name: 'engagement', notes: ['onboarding-journey', 'recognition', 'milestones', 'annual-gathering'] },
      ],
    },
    {
      name: 'business',
      notes: ['operations-and-trajectory'],
      children: [
        { name: 'brand', notes: ['identity', 'voice-tone', 'visual-identity', 'story', 'positioning', 'media-kit'] },
        { name: 'operations', notes: ['team', 'systems-tools', 'finance', 'legal', 'project-management', 'sops'] },
        { name: 'marketing', notes: ['content-strategy', 'social', 'email', 'podcast', 'youtube', 'seo', 'paid', 'partnerships', 'pr', 'funnels'] },
        { name: 'sales', notes: ['process', 'discovery-calls', 'proposals', 'pricing', 'crm', 'pipeline'] },
        { name: 'client-experience', notes: ['onboarding', 'delivery', 'support', 'feedback', 'testimonials', 'case-studies', 'alumni'] },
        { name: 'phases', notes: ['phase-1-foundation', 'phase-2-traction', 'phase-3-scale', 'phase-4-movement', 'metrics'] },
      ],
    },
    {
      name: 'platform',
      notes: ['tech-infrastructure'],
      children: [
        { name: 'learning', notes: ['course-delivery', 'live-sessions', 'forums', 'resource-library', 'progress-tracking', 'peer-matching'] },
        { name: 'community-hub', notes: ['profiles', 'discussion', 'events-calendar', 'collaboration', 'mentorship-matching', 'project-spaces'] },
        { name: 'practitioner-tools', notes: ['client-management', 'session-notes', 'assessments', 'progress-dashboards', 'referrals', 'supervision'] },
        { name: 'ai-automation', notes: ['relational-companion', 'practice-prompts', 'journaling', 'matching', 'analytics', 'support-bot'] },
        { name: 'integrations', notes: ['calendar', 'payments', 'email', 'video', 'crm', 'social-apis'] },
      ],
    },
    {
      name: 'voice',
      notes: ['outward-expression'],
      children: [
        { name: 'podcast', notes: ['the-podcast', 'episode-archive', 'guest-pipeline', 'production'] },
        { name: 'writing', notes: ['book', 'articles', 'newsletter', 'white-papers', 'case-studies'] },
        { name: 'video', notes: ['youtube', 'course-videos', 'social-clips', 'documentary', 'live-streams'] },
        { name: 'social', notes: ['instagram', 'linkedin', 'tiktok', 'twitter-x', 'facebook', 'threads'] },
        { name: 'resources', notes: ['worksheets', 'guided-practices', 'assessments', 'infographics', 'templates', 'reading-lists'] },
      ],
    },
    {
      name: 'evidence',
      notes: ['proof-and-outcomes'],
      children: [
        { name: 'foundational-science', notes: ['attachment-theory', 'interpersonal-neurobiology', 'polyvagal', 'relational-psychoanalysis', 'positive-psychology', 'complexity-science'] },
        { name: 'applied-research', notes: ['program-outcomes', 'practitioner-effectiveness', 'organizational-impact', 'longitudinal-studies'] },
        { name: 'academic-partnerships', notes: ['university-collaborations', 'grants', 'peer-reviewed-publications', 'doctoral-projects'] },
        { name: 'humanity-outcomes', notes: ['more-grounded', 'more-present', 'more-connected', 'more-fulfilled'] },
        { name: 'systemic-change', notes: ['education', 'workplaces', 'healthcare', 'media', 'policy'] },
        { name: 'legacy', notes: ['ri-institute', 'ri-foundation', 'open-source-curricula', 'global-guild', 'intergenerational-research'] },
      ],
    },
  ],
}

interface Update {
  segments: string[]
  name: string
  children: string[]
  notes: string[]
}

function collectUpdates(node: HiveTile, segments: string[], out: Update[]): void {
  const childNames = (node.children ?? []).map(c => c.name)
  const notes = node.notes ?? []
  if (childNames.length > 0 || notes.length > 0 || segments.length === 0) {
    out.push({
      segments: segments.slice(),
      name: node.name,
      children: childNames,
      notes,
    })
  }
  for (const child of node.children ?? []) {
    collectUpdates(child, [...segments, child.name], out)
  }
}

async function main(): Promise<void> {
  const updates: Update[] = []
  collectUpdates(HIVE, [], updates)

  console.log(`[build-hive] ${updates.length} tiles to commit`)
  console.log(`[build-hive] total notes: ${updates.reduce((n, u) => n + u.notes.length, 0)}`)

  let okCount = 0
  let failCount = 0

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i]
    const path = u.segments.length === 0 ? '(root)' : u.segments.join('/')
    process.stdout.write(`[${i + 1}/${updates.length}] ${path} ← ${u.children.length} children, ${u.notes.length} notes ... `)

    const layer: { name: string; children?: string[]; notes?: string[] } = { name: u.name }
    if (u.children.length) layer.children = u.children
    if (u.notes.length) layer.notes = u.notes

    const res = await send({
      op: 'update',
      segments: u.segments,
      layer,
    })

    if (res.ok) {
      okCount++
      console.log('ok')
    } else {
      failCount++
      console.log(`FAIL: ${res.error}`)
    }
  }

  console.log('')
  console.log(`[build-hive] complete`)
  console.log(`  updates: ${okCount} ok, ${failCount} failed`)
}

main().catch(err => { console.error(err); process.exit(1) })
