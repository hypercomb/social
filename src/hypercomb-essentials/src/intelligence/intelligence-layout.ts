// The group layout inside the folder /intelligence grants.
//
// The bytes match scripts/intelligence/disk.cjs. group.json names the problem.
// A result is a member of the pool intelligence:<group>, not a line in a list.
// The resource stays on the host.

export const LINEAGE_GROUP = 'lineage-of-science'
export const LINEAGE_PROBLEM = 'The public proofs the community stamps'

export type LayoutDirectory = {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<LayoutDirectory>
  getFileHandle(name: string): Promise<{ getFile(): Promise<{ text(): Promise<string> }> }>
}

export type LayoutWriter = (dir: LayoutDirectory, name: string, text: string) => Promise<void>

const slug = (name: string): string => {
  const out = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!out || /^[0-9a-f]{64}$/.test(out)) throw new Error('a group needs a name')
  return out
}

export const groupDocument = (name: string, problem: string): string =>
  `${JSON.stringify({ kind: 'intelligence-group', name, problem }, null, 2)}\n`

const readText = async (dir: LayoutDirectory, name: string): Promise<string | null> => {
  try {
    const handle = await dir.getFileHandle(name)
    return await (await handle.getFile()).text()
  } catch (error) {
    if ((error as { name?: string })?.name === 'NotFoundError') return null
    throw error
  }
}

/** Creates the group folder and group.json when they are absent. An existing group.json stays. */
export const ensureGroup = async (
  root: LayoutDirectory,
  write: LayoutWriter,
  name: string,
  problem: string,
): Promise<void> => {
  const text = problem.trim()
  if (!text) throw new Error('a group needs the problem it solves')
  const folderName = slug(name)
  const dir = await root.getDirectoryHandle(folderName, { create: true })
  if (await readText(dir, 'group.json') == null) await write(dir, 'group.json', groupDocument(folderName, text))
}
