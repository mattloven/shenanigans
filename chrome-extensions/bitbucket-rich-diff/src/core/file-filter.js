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

/**
 * @param {string | null | undefined} path
 * @param {{ hideMarkdown: boolean, hiddenExtensions: string[] }} settings
 */
export function isHiddenFile(path, settings) {
  if (!path) return false;
  const lower = path.toLowerCase();
  const extensions = settings.hideMarkdown ? [...settings.hiddenExtensions, ...MARKDOWN_EXTENSIONS] : settings.hiddenExtensions;
  return extensions.some((ext) => lower.endsWith(ext));
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
