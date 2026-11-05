import { groupCountText } from '../core/file-filter.js';

const SKIP = '.bbrd-stats, .bbrd-filters, .bbrd-tabs, .bbrd-host, .bbrd-menu-host, .bbrd-pill, [data-line-type], pre, code, .chunk-heading-middle, .chunk-heading-wrapper, input, textarea, script, style';

const COUNT_PART = String.raw`\d[\d,]*\s+(?:comments?|lines?\s+(?:added|removed|changed|hidden))`;
const COUNT_PHRASE = new RegExp(`^${COUNT_PART}(?:(?:,)?(?:\\s+and)?\\s+${COUNT_PART})*$`, 'i');
const COUNTER = /^(?:comments\s*\(\s*\d[\d,]*\s*(?:unresolved)?\s*\)|\d[\d,]*\s+of\s+\d[\d,]*(?:\s+files?\s+viewed)?|\d[\d,]*\s+files?\s+changed)$/i;
const SIGNED = /^[+\-−]?\d[\d,]*$/;

/**
 * Writes thousands separators into Bitbucket's own Files changed counts: the file list,
 * Lines updated, viewed and changed counters, and diff line numbers. Code, filenames,
 * and hunk headings are left alone. Safe to call on every scan.
 * @param {ParentNode} root
 */
export function groupCounts(root) {
  const scope = root?.nodeType === 9 ? root.body : root;
  const doc = scope?.ownerDocument ?? (scope?.nodeType === 9 ? scope : null);
  if (!scope || !doc?.createTreeWalker) return;
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const el = node.parentElement;
    if (el && shouldGroup(el, node.textContent)) {
      const next = groupCountText(node.textContent);
      if (next !== node.textContent) node.textContent = next;
    }
    node = walker.nextNode();
  }
}

function shouldGroup(el, raw) {
  if (el.closest(SKIP)) return false;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120) return false;
  if (COUNTER.test(text)) return true;
  if (!el.closest('#file-tree, .line-numbers, a.line-number-permalink')) return false;
  return SIGNED.test(text) || COUNT_PHRASE.test(text);
}
