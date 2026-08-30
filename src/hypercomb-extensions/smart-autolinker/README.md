# Smart Autolinker

A local Chrome/Edge Manifest V3 extension that turns configured words or phrases into links inside rich-text editors. It runs on typing and paste, starts with LinkedIn enabled, and can be enabled for additional domains such as Gmail.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Install in Edge

1. Open `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

Click the extension button and choose **Manage links and sites**. Add a word or phrase, its full `https://` URL, and any extra sites where it should run. Reload pages that were already open after first installing the extension.

## Groups

Create groups such as **Pheromones**, **Email**, or **Articles**, then assign each replacement to a group. The popup lets you activate or deactivate groups quickly. In advanced settings, each enabled domain has its own group checklist, so Gmail can use email links while LinkedIn can use article-specific links. A replacement runs only when its group is active and allowed for the current domain.

If the same active phrase has more than one eligible destination URL, an in-place chooser appears beside the editor. Pick the group and URL to use; that choice is applied to matching occurrences from the current typing or paste pass.

## Hypercomb publications

The settings page has a **Hypercomb publications** section that syncs your
published domains straight from the signed ledger (default
`https://pluginthematrix.com/publications.json`). Sync fetches the ledger,
follows each site's verified head signature, and walks the published tree
(`layer → children → incidence → layer`), minting one replacement per named
creation: the phrase is the tile name (dashed cell names also get a spaced
spelling), the URL is the creation's page on that domain
(`https://revolucion.pluginthematrix.com/flavor-wheel`).

- Synced links live in `chrome.storage.local` under the **Hypercomb** group —
  toggle them per site in settings, or via the group in the popup and
  per-domain rules.
- Re-syncing is cheap: a site whose head signature is unchanged reuses its
  cached links without refetching the tree.
- Publish something new, press **Sync publications**, and its whole tree is
  immediately linkable while you type.

## Behavior and limits

- Matches whole words/phrases, case-insensitively by default.
- Does not modify existing links, code, or preformatted content.
- Works in HTML `contenteditable` rich-text editors. Plain `<textarea>` fields cannot contain clickable HTML links.
- Site editors can change their markup. If LinkedIn changes its editor substantially, the content-script targeting may need an update.
- Settings sync through the browser profile via `chrome.storage.sync`.
