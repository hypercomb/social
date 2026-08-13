/**
 * Hypercomb <-> Google Docs bridge (Apps Script Web App).
 *
 * One deployment gives the hive three verbs over the deploying account's Docs:
 *   GET  ?action=list                    -> every Doc: id, name, url, modified, parents
 *   GET  ?action=get&id=<id>             -> current body as markdown (or html/text)
 *   POST {action:'update', id, markdown} -> replace the Doc body from the hive
 *
 * The account that DEPLOYS this owns the docs it can see — there is no account
 * switching here, which is why the deploy step answers "which Google account"
 * on its own.
 *
 * Write model: the hive holds the canonical markdown body; a save PATCHes the
 * whole Doc. Google mints its own revision on every PATCH, so the pre-push
 * version stays recoverable in File > Version history even though we replace
 * wholesale. `baseVersion` guards it: if the Doc moved in Google since the hive
 * last read it, the update is REFUSED rather than silently clobbering.
 */

// Shared secret. Replace before deploying, and treat the deployed URL + this
// token together as a credential: anyone holding both can read and rewrite
// every Doc in the deploying account.
const TOKEN = 'CHANGE-ME-TO-A-LONG-RANDOM-STRING'

const DOC_MIME = 'application/vnd.google-apps.document'

function doGet(e) {
  const p = (e && e.parameter) || {}
  if (p.token !== TOKEN) return out({ ok: false, error: 'unauthorized' })
  try {
    switch (p.action || 'list') {
      case 'list': return out(list(p.pageToken, Number(p.limit || 200)))
      case 'get': return out(read(p.id, p.format || 'markdown'))
      default: return out({ ok: false, error: 'unknown action: ' + p.action })
    }
  } catch (err) {
    return out({ ok: false, error: String(err) })
  }
}

function doPost(e) {
  let body
  try {
    body = JSON.parse(e.postData.contents)
  } catch (err) {
    return out({ ok: false, error: 'bad json body' })
  }
  if (body.token !== TOKEN) return out({ ok: false, error: 'unauthorized' })
  try {
    switch (body.action) {
      case 'update': return out(update(body.id, body.markdown, body.baseVersion))
      case 'create': return out(create(body.name, body.markdown, body.folderId))
      default: return out({ ok: false, error: 'unknown action: ' + body.action })
    }
  } catch (err) {
    return out({ ok: false, error: String(err) })
  }
}

/**
 * Every Doc in the account, paged. DriveApp's continuation token survives
 * across requests, so a large Drive pages without hitting the 6-minute
 * execution ceiling: pass the returned nextPageToken back as ?pageToken=.
 */
function list(pageToken, limit) {
  const iterator = pageToken
    ? DriveApp.continueFileIterator(pageToken)
    : DriveApp.searchFiles('mimeType = "' + DOC_MIME + '" and trashed = false')

  const docs = []
  while (iterator.hasNext() && docs.length < limit) {
    const file = iterator.next()
    docs.push({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      modified: file.getLastUpdated().toISOString(),
      owner: attempt(function () { return file.getOwner().getEmail() }),
      parents: parentsOf(file)
    })
  }

  return {
    ok: true,
    docs: docs,
    nextPageToken: iterator.hasNext() ? iterator.getContinuationToken() : null
  }
}

/**
 * Immediate parents only. The full path would cost a walk per file and the
 * hive reorganizes by pheromone anyway — the folder is a hint to mark from,
 * not the structure we keep.
 */
function parentsOf(file) {
  const parents = []
  const iterator = file.getParents()
  while (iterator.hasNext()) {
    const parent = iterator.next()
    parents.push({ id: parent.getId(), name: parent.getName() })
  }
  return parents
}

/**
 * Export the current body. Markdown is the default because it is the only
 * format that survives the round trip: Docs both exports AND imports it, so
 * headings, bold, lists and links come back as real Doc structure on write.
 */
function read(id, format) {
  const mime = format === 'html' ? 'text/html'
    : format === 'text' ? 'text/plain'
    : 'text/markdown'

  const file = DriveApp.getFileById(id)
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '/export?mimeType=' + encodeURIComponent(mime),
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
  )

  if (response.getResponseCode() !== 200) {
    return { ok: false, error: 'export failed: ' + response.getContentText().slice(0, 300) }
  }

  return {
    ok: true,
    id: id,
    name: file.getName(),
    format: format,
    modified: file.getLastUpdated().toISOString(),
    version: versionOf(id),
    content: response.getContentText()
  }
}

/**
 * Replace the Doc body with the hive's canonical markdown.
 *
 * baseVersion is the `version` the hive got from read(). If Google's version
 * has moved past it, someone edited in Google after the hive last pulled and
 * this returns {ok:false, error:'stale'} instead of overwriting their work.
 * Pass null to force.
 */
function update(id, markdown, baseVersion) {
  const current = versionOf(id)
  if (baseVersion && current && String(baseVersion) !== String(current)) {
    return { ok: false, error: 'stale', current: current, base: baseVersion }
  }

  // The target mimeType is what triggers conversion. A bare media upload does
  // NOT convert — it would replace the Doc with the literal markdown source
  // ("# Heading" as visible text) and still return success. Declaring
  // GOOGLE_DOCS here is the whole reason this round trips.
  Drive.Files.update(
    { mimeType: DOC_MIME },
    id,
    Utilities.newBlob(markdown || '', 'text/markdown')
  )

  return { ok: true, id: id, version: versionOf(id) }
}

/**
 * New Doc from hive content. Created empty through DocumentApp (which converts
 * for free), then filled by the same markdown path as update() so there is one
 * write route, not two.
 */
function create(name, markdown, folderId) {
  const metadata = { name: name || 'Untitled', mimeType: DOC_MIME }
  if (folderId) metadata.parents = [folderId]

  const file = Drive.Files.create(
    metadata,
    Utilities.newBlob(markdown || '', 'text/markdown')
  )

  return {
    ok: true,
    id: file.id,
    url: 'https://docs.google.com/document/d/' + file.id + '/edit'
  }
}

/** Drive's monotonic version counter — the concurrency stamp for update(). */
function versionOf(id) {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=version',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
  )
  if (response.getResponseCode() !== 200) return null
  return JSON.parse(response.getContentText()).version
}

function attempt(fn) {
  try { return fn() } catch (err) { return null }
}

/** Apps Script cannot set HTTP status codes — failures ride in {ok:false}. */
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}
