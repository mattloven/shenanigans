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
| Markdown | **Diff** · **Rich Diff** · **Preview** |
| JSON | **Diff** · **Rich Diff** · **Tree** |

- **Diff**: Bitbucket's own diff, untouched, including inline comments.
- The rich panel replaces the diff body in place. Collapsing the file in Bitbucket also hides the panel.
- Tab clicks never toggle Bitbucket's collapse-on-header-click.
- Left and right arrow keys move between tabs.
- The chosen tab is remembered per file while the PR stays open (including across Bitbucket re-renders).
- The default tab per file type is configurable. It defaults to **Rich Diff**.

### Markdown: Rich Diff ("track changes")

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
  using the same block matching as Rich Diff, so the columns don't drift apart. A section that
  exists on only one side leaves a gap on the other side.
- **Old** / **New**: one version, full width.
- Each column is labelled Before/After with its short commit hash. Renamed files also show the old path.
- Added files offer only New, and deleted files only Old. The unavailable options are disabled.

### JSON: Rich Diff (structural)

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

A **Hide** button sits in the top right of the summary bar above the file tree and the diff. It opens one menu. The same controls are in the extension settings:

- **Hide .md files.** Also hides `.markdown`, `.mdown`, `.mkd` and `.mkdn`. The file disappears from the list and from the diff.
- **Hide extensions.** A text field such as `.svg, .lock, .min.js`. A file matches when its path ends with one of those suffixes.
- **Hide test projects.** Hides every file inside a folder whose name ends in `Tests`, such as `Foo.Tests`, `Foo.UnitTests` and `Foo.IntegrationTests`.
- **Hide solution and project files.** `.sln`, `.slnx`, `.slnf`, and every MSBuild project type (`.csproj`, `.fsproj`, `.vbproj`, `.vcxproj`, and the rest of `*proj`).
- **Hide generated files.** Lockfiles, `*.min.js`, `*.min.css`, and generated C# such as `*.Designer.cs` and `*.g.cs`.
- **Hide comment-only files.** A file whose added and removed lines are all comments.
- **Hide pattern.** A regular expression tested against the full path, each folder name, and the file name. An invalid pattern hides nothing.
- Hidden files stay in the page. The Hide flyout (opened from the summary bar) shows the breakdown — how many files, which category, and the `+ −` counts — at the bottom of the menu, with **Show** / **Hide** to bring them back for this visit. Nothing is inserted into the file tree for that summary: Bitbucket re-renders the sidebar and would duplicate any node we add there. A folder these rules hide keeps its **Hidden** pill, and a revealed file keeps its category pill. Both sit in front of the folder or file icon, on the same row. Each kind has its own colour: tests purple, projects teal, generated orange, docs green, comments grey, extensions yellow, pattern red, and Hidden blue.
- **💩 Betterer Bit Bucket** is a summary bar on the Files changed page, directly above the file tree and the diff. It is not a pull request tab. It shows files, lines added (green) and removed (red), markdown files, test files and the tests inside them, project files, generated files, and review comments. The line totals are copied from Bitbucket's **Lines updated** figure in the file tree. The markdown tile reads `N` and **Markdown file** or **Markdown files**. The comment tile reads **Unresolved Comments (N)** and **Resolved Comments (N)** from the comments dropdown and shows `resolved / total resolved`. When the unresolved count is 0, the comments tile shows a green tick. Those headings are removed when the dropdown closes, so the last pair is kept until the unresolved total changes. Per-file comment phrases in the tree are not the total. The Hide button is aligned to the top right of this bar.
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
    bitbucket-cloud.js  PR URL parsing, REST client, URL resolver, DOM sele