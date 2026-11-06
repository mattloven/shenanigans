import { classifyDiffRows, classifySideBySideRows, commentLanguage } from '../core/comments.js';
import { formatCount } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const WRAP = 'data-bbrd-wrap';

/** Removes comment masking so a file can be re-scanned or shown in full. */
export function clearCommentMasks(root) {
  for (const row of root.querySelectorAll('.bbrd-hide-line, .bbrd-fold-line')) row.classList.remove('bbrd-hide-line', 'bbrd-fold-line', 'bbrd-comment-open');
  for (const marked of [...root.querySelectorAll('[data-bbrd-fold-expect]')]) marked.removeAttribute('data-bbrd-fold-expect');
  for (const wrap of [...root.querySelectorAll(`[${WRAP}]`)]) wrap.replaceWith(...wrap.childNodes);
  for (const mark of [...root.querySelectorAll('[data-bbrd-mask]')]) mark.remove();
  for (const cell of root.querySelectorAll('[data-line-type]')) cell.normalize();
}

/**
 * Hides comment text in one highlighted diff cell. Intervals are indexes into the cell's
 * text content. Existing highlight spans are preserved; only the commented slice is wrapped.
 */
export function maskCell(cell, intervals) {
  if (intervals.length === 0) return;
  const leaves = [];
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    leaves.push({ node, start: offset });
    offset += node.nodeValue.length;
    node = walker.nextNode();
  }
  for (const leaf of leaves) {
    const end = leaf.start + leaf.node.nodeValue.length;
    const local = [];
    for (const range of intervals) {
      const start = Math.max(range.start, leaf.start) - leaf.start;
      const stop = Math.min(range.end, end) - leaf.start;
      if (start < stop) local.push({ start, end: stop });
    }
    if (local.length > 0) maskText(leaf.node, local);
  }
}

function maskText(node, local) {
  const text = node.nodeValue;
  const pieces = [];
  let cursor = 0;
  for (const range of [...local].sort((a, b) => a.start - b.start)) {
    if (range.start > cursor) pieces.push({ text: text.slice(cursor, range.start), hide: false });
    pieces.push({ text: text.slice(range.start, range.end), hide: true });
    cursor = range.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), hide: false });
  const fragment = document.createDocumentFragment();
  for (const piece of pieces) {
    if (!piece.text) continue;
    if (piece.hide) {
      const span = document.createElement('span');
      span.className = 'bbrd-hide-comment';
      span.setAttribute(WRAP, '');
      span.textContent = piece.text;
      fragment.append(span);
    } else {
      fragment.append(document.createTextNode(piece.text));
    }
  }
  node.parentNode.replaceChild(fragment, node);
}

/**
 * Applies (or clears) comment masking on every code file currently in the diff.
 * Each file is skipped when its lines and the relevant settings have not changed.
 */
export function updateCommentMasks(root, settings) {
  const active = settings.hideCodeComments || settings.hideSummaryComments || settings.collapseSummaryComments;
  for (const article of findFileDiffs(root)) {
    const language = commentLanguage(getFilePath(article));
    const rows = [...article.querySelectorAll('[data-key="code-line"]')];
    const signature = active && language ? `${settings.hideCodeComments}/${settings.hideSummaryComments}/${settings.collapseSummaryComments}/${rows.length}/${textSize(rows)}` : 'off';
    if (signature === 'off') {
      if (article.getAttribute('data-bbrd-comments') !== 'off' || article.querySelector('.bbrd-hide-line, .bbrd-comment-fold, [data-bbrd-mask], [data-bbrd-wrap]')) {
        clearCommentMasks(article);
        for (const fold of article.querySelectorAll('.bbrd-comment-fold')) fold.remove();
        article.removeAttribute('data-bbrd-folds');
        article.setAttribute('data-bbrd-comments', 'off');
      }
      continue;
    }
    // Syntax highlighting 