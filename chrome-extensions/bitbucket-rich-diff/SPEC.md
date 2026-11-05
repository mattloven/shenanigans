# Bitbucket Rich Diff: Specification

Chrome extension (Manifest V3) that improves reviewing Markdown and JSON files in Bitbucket Cloud
pull requests. Line diffs of prose and structured data are hard to read, so reviewers tend to skip
them. This extension adds rendered, change-aware views next to the standard diff.

## Scope (step 1)

| In scope | Out of scope (for now) |
|---|---|
| Bitbucket Cloud (`https://bitbucket.org/*/pull-requests/*`) | Bitbucket Data Center / Server |
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn` | MDX, Mermaid diagrams, math |
| `.json`, `.jsonc`, `.webmanifest` (comments and trailing commas tolerated) | JSON5, YAML |
| Read-only views | Commenting from the rich views (use the Diff tab) |

## User experience

### Tabs

Every supported file in the "Files changed" list gets a tab bar in its sticky file header, to the
left of "Viewed":

| File type | Tabs |
|---|---|
| Markdown | **Diff** · **Rich diff** · **Preview** |
| JSON | **Diff** · **Rich diff** · **Tree** |

- **Diff**: Bitbucket's own diff, untouched, including inline comments.
- The rich panel replaces the diff body in place. Collapsing the file in Bitbucket also hides the panel.
- Tab clicks never toggle Bitbucket's collapse-on-header-click.
- Left and right arrow keys move between tabs.
- The chosen tab is remembered per file while the PR stays open (including across Bitbucket re-renders).
- The default tab per file type is configurable. It defaults to **Rich diff**.

### Markdown: Rich diff ("track changes")

The new version is rendered like a document, with changes marked the way Word's Track Changes does:

- Inserted text: green, underlined. Deleted text: red, struck through.
- A coloured change bar in the left margin marks each changed block: green for added, red for
  removed, orange for modified.
- Granularity adapts to the block type:
  - **Paragraphs, headings, blockquotes**: word-level changes inside the block. If more than 60% of
    the old or new words changed, the old block is shown struck through above the new block instead.
    Fragments of word changes would be harder to read.
  - **Lists**: item by item (added, removed, or edited items). Task-list checkbox toggles show the
    old and new checkbox.
  - **Tables**: row by row, with cell-level word changes. If the column layout changed, the whole
    table is shown as replaced.
  - **Code blocks**: line by line, with +/− markers.
  - Inline code and images are atomic: they are shown as replaced, never split.
- Toolbar (sticky below the file header):
  - Change counts (+ added, − removed, ~ changed).
  - **Show deletions** toggle. When off, you see the final text with insertions highlighted.
  - **Only changes** toggle. Folds runs of unchanged sections into a "Show N unchanged sections"
    button, keeping one section of context on each side of a change.
  - **↑ / ↓** buttons to move between changes. They scroll to the change, open any fold or collapsed
    node it's in, and flash it. A counter shows "3 / 12".
- Relative image and link URLs resolve against the file's revision: images use
  `/{repo}/raw/{commit}/…` and links use `/{repo}/src/{commit}/…`. Old-side blocks resolve against
  the old commit.
- Reference-style links resolve even though blocks are diffed individually.

### Markdown: Preview (plain, no change markup)

A layout switch in the toolbar offers **Old · New · Side by side** (default: Side by side,
remembered):

- **Side by side**: a two-column grid where matching sections share a row. Sections are aligned
  using the same block matching as Rich diff, so the columns don't drift apart. A section that
  exists on only one side leaves a gap on the other side.
- **Old** / **New**: one version, full width.
- Each column is labelled Before/After with its short commit hash. Renamed files also show the old path.
- Added files offer only New, and deleted files only Old. The unavailable options are disabled.

### JSON: Rich diff (structural)

- A **summary table** of every leaf change: path (`dependencies.express`, `featureFlags[0].rollout`,
  `["my-key"]`), change type, and before/after values. Clicking a row jumps to that row in the tree.
- A **tree** in JSON shape:
  - Unchanged containers start collapsed (`{ … } 12 keys`). Changed containers start open.
  - Changed values show the old value struck through next to the new value. Long strings get an
    inline word diff.
  - Added and removed keys or items are highlighted, with full subtrees.
  - Key order changes are not reported as changes. A moved key shows at its new position.
  - Arrays are aligned using a longest-common-subsequence match, so inserting one element doesn't
    mark every later element as changed. Paired objects are compared recursively.
- Toolbar: counts, Show deletions, Only changes, ↑/↓, Expand all / Collapse all.
- If the file isn't valid JSON (even after JSONC tolerance), you get an error with **Retry** and
  **Show standard diff** buttons.

### JSON: Tree (plain)

The same **Old · New · Side by side** switch as the Markdown preview, showing collapsible trees
(opened two levels deep). In side-by-side mode, expanding or collapsing a node on one side does the
same on the other. A parse error affects only its own pane.

### File list filters

A **Hide** button sits immediately to the left of the Files changed cog (the button named Global diff settings, top right of the diff). It opens one menu. Bitbucket re-renders that toolbar as you scroll and load files; the extension moves this same menu onto the new cog instead of inserting another copy. The same controls are in the extension settings:

- **Hide .md files.** Also hides `.markdown`, `.mdown`, `.mkd` and `.mkdn`. The file disappears from the list and from the diff.
- **Hide extensions.** A text field such as `.svg, .lock, .min.js`. A file matches when its path ends with one of those suffixes.
- **Hide test projects.** Hides every file inside a folder whose name ends in `Tests`, such as `Foo.Tests`, `Foo.UnitTests` and `Foo.IntegrationTests`.
- **Hide solution and project files.** `.sln`, `.slnx`, `.slnf`, and every MSBuild project type (`.csproj`, `.fsproj`, `.vbproj`, `.vcxproj`, and the rest of `*proj`).
- **Hide generated files.** Lockfiles, `*.min.js`, `*.min.css`, and generated C# such as `*.Designer.cs` and `*.g.cs`.
- **Hide comment-only files.** A file whose added and removed lines are all comments.
- **Hide pattern.** A regular expression tested against the full path, each folder name, and the file name. An invalid pattern hides nothing.
- Hidden files stay in the page. The Hide flyout (beside the cog) shows the breakdown — how many files, which category, and the `+ −` counts — with **Show** / **Hide** to bring them back for this visit. Nothing is inserted into the file tree for that summary: Bitbucket re-renders the sidebar and would duplicate any node we add there. A folder these rules hide keeps its **Hidden** pill on the existing directory row.
- While files are hidden, Bitbucket's counters keep both numbers: actual (original total minus hidden) and the real total stored on the node the first time we see it. `0 of 14 files viewed` becomes `0 of 12 viewed · 14 files`, and `14 files changed` becomes `12 of 14 files changed`. The viewed numerator counts only files still showing. **Show**, or clearing the rule, restores the original text exactly.
- Opening a test file collapses each test to its name and its own `+ −`. Click the title to read that test.
- The menu reports how many files are hidden.

### Code comments in diffs

For JavaScript, TypeScript (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`) and C# (`.cs`):

- **Hide code comments** removes `//` line comments and `/* … */` block comments.
- **Hide summary comments** removes documentation comments: `///` XML docs in C#, and `/** … */` JSDoc blocks in both languages. A `/***` banner stays a normal block comment.
- A run of lines that are only hidden comments collapses to a "N comment lines" row. Click it to read them. A trailing comment is removed and the code in front of it stays.
- Text inside strings, template literals, C# verbatim and interpolated strings, character literals and JavaScript regexes is left alone. `http://…` inside a string is not treated as a comment.
- Removed and added lines are read as two separate files, because a diff interleaves them. A context line is hidden only when both sides agree it is a hidden comment.
- In side-by-side view each column is masked on its own, so an added comment can disappear while the code it replaced stays visible.
- Comment state carries across the visible lines of a hunk. A block comment that opened in a collapsed part of the file can be missed; expanding the hunk and toggling the option again rescans.

### Settings (popup and options page, synced through `chrome.storage.sync`)

- Per file type: enable tabs, and the default tab.
- Show deletions, Only changes, Preview layout.
- Hide .md files, extra extensions, test projects, a hide pattern, hide code comments, hide summary comments.
- Toolbar toggles and the layout switch write the same settings, and every open file and tab
  updates immediately.

## Architecture

```
src/
  core/                 pure logic, no Bitbucket knowledge (unit tested)
    markdown.js         markdown-it setup (GFM tables, task lists, linkify), URL rewriting, block splitting
    align.js            sequence alignment: key diff plus similarity pairing (Needleman–Wunsch)
    html-diff.js        word-level HTML diff that preserves markup
    markdown-diff.js    track-changes renderer and section alignment for side-by-side preview
    json-diff.js        tolerant parse, structural diff tree, change list
    json-render.js      tree, summary, and plain tree rendering
    file-types.js       extension to type, and tab definitions
    settings.js         defaults, validation, chrome.storage wrapper
  platform/
    bitbucket-cloud.js  PR URL parsing, REST client, URL resolver, DOM selectors
  content/
    index.js            RichDiffApp: MutationObserver over the SPA, one FileView per file
    file-view.js        tabs, shadow-DOM panel, toolbar, navigation, layout switch
    build-view.js       (type, view, data) to panel HTML
    pr-context.js       per-PR cache of diffstat and file contents
  styles/page.css       light-DOM styles (tab bar, hiding the diff body)
  styles/panel.css      shadow-DOM styles (Atlassian --ds-* tokens, so dark mode follows Bitbucket)
  options/              settings page (also the toolbar popup)
```

### Data source

The extension doesn't parse the rendered diff. For each PR it calls Bitbucket's same-origin API
proxy, which the Bitbucket web app also uses, so the user's session cookie authorises the requests
and private repositories work with no token:

1. `GET /!api/2.0/repositories/{ws}/{repo}/pullrequests/{id}/diffstat` (paginated). For every file
   it returns the status, old and new paths (renames), and `links.self` URLs pinned to the exact
   commits Bitbucket diffs: the merge base and the source tip. Forks work too, because each side
   links to its own repository.
2. `GET` those `…/src/{commit}/{path}` URLs to fetch the full old and new contents, lazily, the first
   time a rich view is opened.

Files over 2 MB are refused with a clear message.

### DOM integration (Bitbucket Cloud, verified November 2026)

| Purpose | Selector |
|---|---|
| File diff | `article[data-qa="branch-diff-file"]`, with `aria-label="Diff of file {path}"` |
| Header (sticky, toggles collapse on click) | `[data-qa="bk-file__header"]` |
| Diff body | `[data-qa="bk-file__content"]` |
| Files changed cog | `button` whose accessible name is `Global diff settings` (the name is an inner span; the button has no stable `data-qa`). The Hide button is inserted as the cog's previous sibling. |
| Files viewed count | Leaf text matching `/^\d+ of \d+ files? viewed$/i` (diff toolbar near the cog; mock: `[data-qa="files-viewed-count"]`). While files are hidden this becomes `N of actual viewed · real files`. |
| Files changed count | Leaf text matching `/^\d+ files? changed$/i` (files header / sidebar; mock: `[data-qa="files-changed-count"]`). While files are hidden this becomes `actual of real files changed`. |

- Tabs are inserted before the header's last child (the Viewed/actions group).
- The Hide summary and Show control live only in `.bbrd-filters` (the flyout on `document.body`). Do not insert summary widgets into the file-tree `<ul>`.
- The panel host is inserted right before the diff body. The diff body is hidden by CSS keyed on
  `article[data-bbrd-view]`, never by mutating React-owned styles.
- Bitbucket can re-render headers or articles at any time. A `MutationObserver` re-mounts our nodes,
  debounced to one scan per animation frame.
- SPA navigation to another PR resets all state. Leaving the PR removes everything.
- The panel lives in a shadow root, so Bitbucket's CSS can't leak in. Rendered HTML goes through
  DOMPurify, which strips scripts, event handlers, `<style>` and `<form>`.
- The toolbar sticks below Bitbucket's sticky file header. Its offset is measured from the header.

## Testing

| Layer | Command | What it covers |
|---|---|---|
| Unit (Vitest + jsdom) | `npm test` | HTML word diff, alignment, markdown track changes (paragraphs, lists, tables, code, folding, escaping), JSON parse/diff/render, Bitbucket client (pagination, 404/403, size cap), URL resolution, path detection, settings, preview builder, `RichDiffApp` with a fake client (injection, defaults, disabled types, click isolation, re-render, error path, navigation away) |
| End-to-end (Playwright + Chromium + built extension) | `npm run test:e2e` | **Mock PR** served at a real `bitbucket.org` URL through request interception, mirroring the Bitbucket DOM and API: every tab, toolbar control, persistence, aligned side by side, added/deleted/invalid files, header re-render. **Real public PR** ([atlassian-connect-express #572](https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/572/diff)) as a smoke test. Skip it with `E2E_SKIP_REAL=1`. Screenshots go to `test-results/`. |

Branded Google Chrome 137+ ignores `--load-extension`, so the e2e suite uses Playwright's Chromium
(`npx playwright-core install chromium`).

## Known limitations and next steps

- Inline PR comments appear only in the Diff tab. Possible next step: show comment markers in the
  rich views.
- Bitbucket Data Center has a different DOM and REST API (`/rest/api/1.0/...`). The platform module
  is the seam where a second adapter would go.
- Formatting-only changes, such as making text bold, are rendered but not highlighted as changes.
- The JSON summary lists at most 200 changes and says how many more there are.
