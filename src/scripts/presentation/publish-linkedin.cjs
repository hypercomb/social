// Publish a built post to your own LinkedIn feed, and record where it landed.
//
// The video upload is three calls, not one: register, PUT the bytes in the
// ranges LinkedIn hands back (collecting an ETag per part), finalize. Only then
// can a post reference the video URN. The link block goes up as the first
// comment, which is where it belongs on a video post.
//
//   node publish-linkedin.cjs --check                 # who would this post as?
//   node publish-linkedin.cjs 1 --dry-run             # print every request, send nothing
//   node publish-linkedin.cjs 1 --confirm             # actually publish post 1
//
// The token comes from the environment and is never written anywhere:
//   $env:LINKEDIN_ACCESS_TOKEN = "..."      (PowerShell)
//   export LINKEDIN_ACCESS_TOKEN=...        (bash)
//
// Getting that token is a one-time manual step — see linkedin-setup.md.
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const POSTS_DIR = path.join(ROOT, 'posts')
const API = 'https://api.linkedin.com'
const VERSION = process.env.LINKEDIN_VERSION || '202604'   // LinkedIn-Version is YYYYMM
const TOKEN = process.env.LINKEDIN_ACCESS_TOKEN

const DRY = process.argv.includes('--dry-run')
const CONFIRM = process.argv.includes('--confirm')
const CHECK = process.argv.includes('--check')
const which = process.argv.find(a => /^\d+$/.test(a))

const headers = () => ({
  'Authorization': `Bearer ${TOKEN}`,
  'LinkedIn-Version': VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json',
})

function note(label, detail) { console.log(`  ${label.padEnd(22)} ${detail}`) }

async function api(method, url, body, extra = {}) {
  if (DRY) {
    console.log(`\n[dry-run] ${method} ${url}`)
    if (body) console.log(JSON.stringify(body, null, 2).slice(0, 900))
    return { dryRun: true, headers: new Map() }
  }
  const res = await fetch(url, { method, headers: { ...headers(), ...extra }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}\n${text.slice(0, 600)}`)
  return { json: text ? JSON.parse(text) : null, headers: res.headers }
}

async function me() {
  const res = await fetch(`${API}/v2/userinfo`, { headers: headers() })
  if (!res.ok) throw new Error(`could not identify the token holder → ${res.status} ${await res.text()}`)
  const j = await res.json()
  return { urn: `urn:li:person:${j.sub}`, name: j.name, email: j.email }
}

// --- the three-step video upload --------------------------------------------
async function uploadVideo(file, owner) {
  const size = fs.statSync(file).size
  note('video', `${path.basename(file)} (${(size / 1e6).toFixed(1)} MB)`)

  const init = await api('POST', `${API}/rest/videos?action=initializeUpload`,
    { initializeUploadRequest: { owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } })
  if (DRY) return 'urn:li:video:DRYRUN'

  const value = init.json.value
  const parts = value.uploadInstructions || []
  note('upload parts', String(parts.length))

  const etags = []
  const bytes = fs.readFileSync(file)
  for (const [i, part] of parts.entries()) {
    const chunk = bytes.subarray(part.firstByte, part.lastByte + 1)
    const put = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
      body: chunk,
    })
    if (!put.ok) throw new Error(`chunk ${i + 1} failed → ${put.status} ${await put.text()}`)
    const etag = put.headers.get('etag')
    if (!etag) throw new Error(`chunk ${i + 1} returned no ETag — cannot finalize without it`)
    etags.push(etag.replace(/"/g, ''))
    note(`  part ${i + 1}/${parts.length}`, `${(chunk.length / 1e6).toFixed(1)} MB ok`)
  }

  await api('POST', `${API}/rest/videos?action=finalizeUpload`,
    { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken || '', uploadedPartIds: etags } })
  note('video urn', value.video)
  return value.video
}

async function createPost({ owner, commentary, videoUrn, title }) {
  const body = {
    author: owner,
    commentary,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: videoUrn, title } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  const res = await api('POST', `${API}/rest/posts`, body)
  if (DRY) return 'urn:li:share:DRYRUN'
  const urn = res.headers.get('x-restli-id') || res.json?.id
  if (!urn) throw new Error('post created but no URN came back — check the feed before retrying')
  return urn
}

async function addComment({ owner, postUrn, text }) {
  await api('POST', `${API}/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
    { actor: owner, object: postUrn, message: { text } })
}

// --- the posts, parsed back out of posts.md ---------------------------------
function loadPosts() {
  const md = fs.readFileSync(path.join(POSTS_DIR, 'posts.md'), 'utf8')
  const out = []
  for (const block of md.split(/\n## /).slice(1)) {
    const title = block.split('\n')[0].replace(/^\d+\.\s*/, '').trim()
    const video = (block.match(/\*\*video:\*\* `([^`]+)`/) || [])[1]
    const body = block.split('\n').slice(1).join('\n')
    const copy = body.split('**First comment:**')[0]
      .replace(/\*\*video:\*\*[^\n]*\n/, '').replace(/^\s+|\s+$/g, '')
    const comment = (body.split('**First comment:**')[1] || '').split('---')[0].trim()
    if (video) out.push({ title, video, copy, comment })
  }
  return out
}

;(async () => {
  if (!TOKEN) {
    console.error('LINKEDIN_ACCESS_TOKEN is not set — see linkedin-setup.md. Nothing was sent.')
    process.exit(1)
  }
  const who = DRY ? { urn: 'urn:li:person:DRYRUN', name: '(dry run)' } : await me()
  console.log(`posting as: ${who.name} — ${who.urn}\n`)
  if (CHECK) return

  const posts = loadPosts()
  if (!which) {
    posts.forEach((p, i) => console.log(`  ${i + 1}. ${p.title}  (${p.video})`))
    console.log('\npick one: node publish-linkedin.cjs <n> --dry-run | --confirm')
    return
  }
  const post = posts[Number(which) - 1]
  if (!post) throw new Error(`no post ${which} — there are ${posts.length}`)

  const file = path.join(ROOT, post.video.replace(/^posts\//, 'posts/'))
  if (!fs.existsSync(file)) throw new Error(`missing video: ${file}`)
  if (post.comment.includes('<paste')) console.log('note: the first comment still has a placeholder link in it\n')

  console.log(`post ${which}: ${post.title}`)
  note('copy', `${post.copy.split('\n')[0].slice(0, 60)}…`)

  if (!CONFIRM && !DRY) {
    console.log('\nThis publishes to your public feed. Nothing has been sent.')
    console.log('Re-run with --dry-run to see the exact requests, or --confirm to publish.')
    return
  }

  const videoUrn = await uploadVideo(file, who.urn)
  const postUrn = await createPost({ owner: who.urn, commentary: post.copy, videoUrn, title: post.title })
  const url = `https://www.linkedin.com/feed/update/${postUrn}/`
  console.log(`\npublished: ${url}`)

  if (post.comment && !post.comment.includes('<paste')) {
    await addComment({ owner: who.urn, postUrn, text: post.comment })
    console.log('first comment: posted')
  } else {
    console.log('first comment: skipped — add the links by hand, or fill FIRST_POST_URL and re-run posts.cjs --copy-only')
  }

  if (!DRY) {
    const log = path.join(POSTS_DIR, 'published.json')
    const rows = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []
    rows.push({ n: Number(which), title: post.title, url, urn: postUrn, video: post.video })
    fs.writeFileSync(log, JSON.stringify(rows, null, 2))
    console.log(`recorded in ${path.relative(process.cwd(), log)}`)
  }
})().catch(e => { console.error('\npublish failed:', e.message); process.exit(1) })
