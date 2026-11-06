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

The sa