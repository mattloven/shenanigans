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
 * @param {string | null | undefined} path
 * @param {{ hideMarkdown?: boolean, hiddenExtensions?: string[], hideTestFolders?: boolean, hidePattern?: string }} settings
 */
export function isHiddenFile(path, settings) {
  if (!path) return false;
  const lower = path.toLowerCase();
  const hiddenExtensions = settings.hiddenExtensions ?? [];
  const extensions = settings.hideMarkdown ? [...hiddenExtensions, ...MARKDOWN_EXTENSIONS] : hiddenExtensions;
  if (extensions.some((ext) => lower.endsWith(ext))) return true;
  const segments = path.split(/[\\/]/).filter(Boolean);
  const folders = segments.slice(0, -1);
  if (settings.hideTestFolders && folders.some((segment) => TEST_FOLDER.test(segment))) return true;
  const pattern = compileHidePattern(settings.hidePattern);
  if (pattern && (patternMatches(pattern, path) || segments.some((segment) => patternMatches(pattern, segment)))) return true;
  return false;
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
