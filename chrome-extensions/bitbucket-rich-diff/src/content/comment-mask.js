import { classifyDiffRows, commentLanguage } from '../core/comments.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const WRAP = 'data-bbrd-wrap';

/** Removes comment masking so a file can be re-scanned or shown in full. */
export function clearCommentMasks(root) {
  for (const row of root.querySelectorAll('.bbrd-hide-line')) row.classList.remove('bbrd-hide-line');
  for (const wrap of [...root.querySelectorAll(`[${WRAP}]`)]) wrap.replaceWith(...wrap.childNodes);
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
  const active = settings.hideCodeComments || settings.hideSummaryComments;
  for (const article of findFileDiffs(root)) {
    const language = commentLanguage(getFilePath(article));
    const rows = [...article.querySelectorAll('[data-key="code-line"]')];
    const signature = active && language ? `${settings.hideCodeComments}/${settings.hideSummaryComments}/${rows.length}/${textSize(rows)}` : 'off';
    if (article.getAttribute('data-bbrd-comments') === signature) continue;
    clearCommentMasks(article);
    if (signature !== 'off') maskArticle(article, rows, language, settings);
    article.setAttribute('data-bbrd-comments', signature);
  }
}

function textSize(rows) {
  let size = 0;
  for (const row of rows) size += row.querySelector('[data-line-type]')?.textContent.length ?? 0;
  return size;
}

function maskArticle(article, rows, language, settings) {
  const described = [];
  for (const row of rows) {
    const cell = row.querySelector('[data-line-type]');
    if (!cell) continue;
    const typeAttr = cell.getAttribute('data-line-type');
    const type = typeAttr === '+' || typeAttr === '-' ? typeAttr : ' ';
    described.push({ row, cell, type, text: cell.textContent });
  }
  const classified = classifyDiffRows(
    described.map((row) => ({ type: row.type, text: row.text })),
    language,
    settings,
  );
  described.forEach((row, index) => {
    const { hideLine, intervals } = classified[index];
    row.row.classList.toggle('bbrd-hide-line', hideLine);
    if (!hideLine) maskCell(row.cell, intervals);
  });
}
