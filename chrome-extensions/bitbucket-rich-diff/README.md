# Bitbucket Rich Diff

A Chrome extension that adds **Diff · Rich diff · Preview** tabs to Markdown and JSON files in
Bitbucket Cloud pull requests.

- **Rich diff (Markdown)**: the rendered document with Word-style tracked changes (insertions
  underlined in green, deletions struck through in red, and change bars in the margin). Lists,
  tables and code blocks are compared item by item, row by row and line by line.
- **Rich diff (JSON)**: a structural diff. A summary table of changed paths sits above a collapsible
  tree. Key reordering is ignored, and arrays are aligned.
- **Preview / Tree**: plain rendering of the old version, the new version, or both side by side,
  with matching sections aligned.
- **File list filters**: hide Markdown files, hide any extensions you type (`.svg, .lock, …`), and
  hide code comments or summary comments (`///`, `/** */`) in JavaScript, TypeScript and C# diffs.

See [SPEC.md](SPEC.md) for the full behaviour and design.

## Install (unpacked)

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Open any pull request on bitbucket.org and go to **Files changed**.

Settings are in the extension's toolbar popup.

## Develop

```bash
npm run watch        # rebuild dist/ on change (then reload the extension)
npm test             # unit tests (Vitest + jsdom)
npx playwright-core install chromium
npm run test:e2e     # builds, then runs the extension in Chromium against a mock PR and a real public PR
npm run package      # dist/ zipped into bitbucket-rich-diff.zip
```

`scripts/live-driver.mjs` drives a visible Chromium started with `--remote-debugging-port=9222`.
It keeps the mock PR at `https://bitbucket.org/acme/payments/pull-requests/42/diff` available and
exposes `/mock`, `/reload` (reloads the extension), `/goto`, `/do` and `/shot` on `localhost:5055`.
