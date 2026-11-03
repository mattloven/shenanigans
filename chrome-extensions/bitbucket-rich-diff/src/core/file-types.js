/** @typedef {'markdown' | 'json'} RichFileType */

const MARKDOWN_EXT = /\.(?:md|markdown|mdown|mkd|mkdn)$/i;
const JSON_EXT = /\.(?:json|jsonc|webmanifest)$/i;

/** @returns {RichFileType | null} */
export function detectFileType(path) {
  if (!path) return null;
  if (MARKDOWN_EXT.test(path)) return 'markdown';
  if (JSON_EXT.test(path)) return 'json';
  return null;
}

/** @typedef {'diff' | 'changes' | 'preview'} ViewId */

/** @type {Record<RichFileType, Array<{ id: ViewId, label: string, title: string }>>} */
export const VIEWS = {
  markdown: [
    { id: 'diff', label: 'Diff', title: 'Standard Bitbucket diff (with comments)' },
    { id: 'changes', label: 'Rich diff', title: 'Rendered markdown with tracked changes' },
    { id: 'preview', label: 'Preview', title: 'Rendered markdown of the new version' },
  ],
  json: [
    { id: 'diff', label: 'Diff', title: 'Standard Bitbucket diff (with comments)' },
    { id: 'changes', label: 'Rich diff', title: 'Structural diff: changed keys and values' },
    { id: 'preview', label: 'Tree', title: 'Collapsible tree of the new version' },
  ],
};
