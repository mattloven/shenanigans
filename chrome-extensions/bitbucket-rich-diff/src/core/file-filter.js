/** Extensions covered by the "Hide .md files" shortcut. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'];

/**
 * Parses a user-typed extension list: ".svg, lock, .min.js" becomes [".svg", ".lock", ".min.js"].
 * @param {string | string[]} value
 * @returns {string[]}
 */
export function parseExtensions(value) {
  const text = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const seen = new Set();
  const out = [];
  for (const part of text.split(/[\s,]+/)) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    const ext = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    if (!/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(ext)) continue;
    if (seen.has(ext)) continue;
    seen.add(ext);
    out.push(ext);
  }
  return out;
}

/** A test project folder: the name ends in Tests, as in Foo.Tests or Foo.UnitTests. */
export const TEST_FOLDER = /.*Tests$/i;

/** Solution files and every MSBuild project type: .sln, .slnx, .csproj, .fsproj, .vbproj, .vcxproj, … */
const PROJECT_FILE = /\.(?:[a-z0-9]*proj|projitems|sln|slnx|slnf)$/i;

const GENERATED_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'packages.lock.json',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'cargo.lock',
  'go.sum',
  'podfile.lock',
  'package.resolved',
]);

const GENERATED_FILE = /\.(?:min\.js|min\.css|designer\.cs|g\.cs|g\.i\.cs|generated\.cs)$/i;

function fileName(path) {
  const segments = String(path ?? '').split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/** @param {string | null | undefined} path */
export function isProjectFile(path) {
  return PROJECT_FILE.test(fileName(path));
}

/** @param {string | null | undefined} path */
export function isGeneratedFile(path) {
  const name = fileName(path);
  return GENERATED_NAMES.has(name.toLowerCase()) || GENERATED_FILE.test(name);
}

/** @param {string | null | undefined} path */
export function isMarkdownFile(path) {
  const lower = String(path ?? '').toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** @typedef {'projects' | 'tests' | 'generated' | 'docs' | 'extensions' | 'pattern' | 'comments'} HideCategory */

export const CATEGORY_ORDER = ['tests', 'projects', 'generated', 'docs', 'comments', 'extensions', 'pattern'];

const CATEGORY_WORD = {
  tests: ['test', 'tests'],
  projects: ['project', 'projects'],
  generated: ['generated', 'generated'],
  docs: ['doc', 'docs'],
  comments: ['comment-only', 'comment-only'],
  extensions: ['extension', 'extensions'],
  pattern: ['pattern', 'pattern'],
};

/** Short label for a chip beside a revealed file. */
export const CATEGORY_LABEL = {
  tests: 'Tests',
  projects: 'Project',
  generated: 'Generated',
  docs: 'Docs',
  comments: 'Comments',
  extensions: 'Extension',
  pattern: 'Pattern',
};

const MAX_PATTERN_LENGTH = 200;

/**
 * @param {string | null | undefined} source
 * @returns {RegExp | null} null when the field is empty or the pattern is not valid
 */
export function compileHidePattern(source) {
  const text = String(source ?? '').trim();
  if (!text || text.length > MAX_PATTERN_LENGTH) return null;
  try {
    return new RegExp(text);
  } catch {
    return null;
  }
}

function patternMatches(pattern, value) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

/**
 * Which hide rule claims this path, or null when the file stays in the review.
 * A path category wins over "comment-only", and the first matching category wins.
 * @param {string | null | undefined} path
 * @param {{ hideMarkdown?: boolean, hiddenExtensions?: string[], hideTestFolders?: boolean, hideProjects?: boolean, hideGenerated?: boolean, hideCommentFiles?: boolean, hidePattern?: string }} settings
 * @param {Set<string> | undefined} commentOnly paths whose diff is only comments
 * @returns {HideCategory | null}
 */
export function fileCategory(path, settings, commentOnly) {
  if (!path) return null;
  const segments = path.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  const lower = path.toLowerCase();
  const folders = segments.slice(0, -1);
  if (settings.hideProjects && PROJECT_FILE.test(name)) return 'projects';
  if (settings.hideTestFolders && folders.some((segment) => TEST_FOLDER.test(segment))) return 'tests';
  if (settings.hideGenerated && (GENERATED_NAMES.has(name.toLowerCase()) || GENERATED_FILE.test(name))) return 'generated';
  if (settings.hideMarkdown && MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'docs';
  const hiddenExtensions = settings.hiddenExtensions ?? [];
  if (hiddenExtensions.some((ext) => lower.endsWith(ext))) return 'extensions';
  const pattern = compileHidePattern(settings.hidePattern);
  if (pattern && (patternMatches(pattern, path) || segments.some((segment) => patternMatches(pattern, segment)))) return 'pattern';
  if (settings.hideCommentFiles && commentOnly?.has(path)) return 'comments';
  return null;
}

/**
 * @param {string | null | undefined} path
 * @param {{ hideMarkdown?: boolean, hiddenExtensions?: string[], hideTestFolders?: boolean, hideProjects?: boolean, hideGenerated?: boolean, hideCommentFiles?: boolean, hidePattern?: string }} settings
 * @param {Set<string> | undefined} [commentOnly]
 */
export function isHiddenFile(path, settings, commentOnly) {
  return fileCategory(path, settings, commentOnly) !== null;
}

/**
 * "6 hidden · 4 tests · 1 project +12 −3"
 * @param {Partial<Record<HideCategory, number>>} counts
 * @param {{ added?: number, removed?: number }} [lines]
 */
export function formatHideSummary(counts, lines) {
  const total = CATEGORY_ORDER.reduce((sum, key) => sum + (counts[key] || 0), 0);
  if (!total) return '';
  const parts = [`${total} hidden`];
  for (const key of CATEGORY_ORDER) {
    const count = counts[key] || 0;
    if (!count) continue;
    const [one, many] = CATEGORY_WORD[key];
    parts.push(`${count} ${count === 1 ? one : many}`);
  }
  let text = parts.join(' · ');
  if (lines && (lines.added || lines.removed)) text += ` +${lines.added || 0} −${lines.removed || 0}`;
  return text;
}

/**
 * A directory row in the file tree. True when this folder is one the test-project or pattern
 * rule hides. The row stays on screen; the files inside it are hidden separately.
 * @param {string | null | undefined} path directory path or a single folder name
 * @param {{ hideTestFolders?: boolean, hidePattern?: string }} settings
 */
export function isHiddenFolder(path, settings) {
  if (!path) return false;
  const segments = String(path).split(/[\\/]/).filter(Boolean);
  if (!segments.length) return false;
  if (settings.hideTestFolders && segments.some((segment) => TEST_FOLDER.test(segment))) return true;
  const pattern = compileHidePattern(settings.hidePattern);
  return !!pattern && (patternMatches(pattern, path) || segments.some((segment) => patternMatches(pattern, segment)));
}

/** Path carried by a Bitbucket file-list link (`#chg-docs/README.md`). */
export function pathFromFileLink(href) {
  if (!href) return null;
  const marker = '#chg-';
  const index = href.indexOf(marker);
  if (index === -1) return null;
  try {
    return decodeURIComponent(href.slice(index + marker.length));
  } catch {
    return href.slice(index + marker.length);
  }
}
