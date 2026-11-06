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
    // Syntax highlighting rewrites the cell after we mask it. The line text stays the
    // same, so the signature matches, but the mask marker is gone and has to be put back.
    if (article.getAttribute('data-bbrd-comments') === signature && masksIntact(rows)) {
      concealVanishedRows(article);
      foldCommentRuns(article, getFilePath(article));
      continue;
    }
    clearCommentMasks(article);
    for (const fold of article.querySelectorAll('.bbrd-comment-fold')) fold.remove();
    article.removeAttribute('data-bbrd-folds');
    if (signature !== 'off') maskArticle(rows, language, settings);
    article.setAttribute('data-bbrd-comments', signature);
    concealVanishedRows(article);
    foldCommentRuns(article, getFilePath(article));
  }
}

/** Paths whose every added or removed line is a fully hidden comment. */
export function commentOnlyPaths(root) {
  const paths = new Set();
  for (const article of findFileDiffs(root)) {
    let changed = 0;
    let hidden = 0;
    for (const row of article.querySelectorAll('[data-key="code-line"]')) {
      const isChange = [...row.querySelectorAll('[data-line-type]')].some((cell) => {
        const type = cell.getAttribute('data-line-type');
        return type === '+' || type === '-';
      });
      if (!isChange) continue;
      changed += 1;
      if (row.classList.contains('bbrd-hide-line')) hidden += 1;
    }
    if (changed > 0 && hidden === changed) {
      const path = getFilePath(article);
      if (path) paths.add(path);
    }
  }
  return paths;
}

/** @type {Set<string>} */
const openCommentFolds = new Set();

function setCommentOpen(rows, open) {
  for (const row of rows) {
    row.classList.toggle('bbrd-comment-open', open);
    // Side-by-side cells carry hide/fold on the inner line; keep those in sync too.
    for (const inner of row.querySelectorAll('.bbrd-hide-line, .bbrd-fold-line')) {
      inner.classList.toggle('bbrd-comment-open', open);
    }
  }
}

function foldKey(path, index, run) {
  return `${path}\n${index}\n${(run[0].textContent ?? '').slice(0, 40)}`;
}

function syncCommentFold(fold, run, key) {
  const open = openCommentFolds.has(key);
  fold.setAttribute('aria-expanded', open ? 'true' : 'false');
  setCommentOpen(run, open);
  for (const row of run) {
    row.classList.add('bbrd-hide-line');
    // Blank side-by-side partners must hide with the run, not only the commented cell.
    for (const line of row.querySelectorAll('[data-qa="code-line"]')) line.classList.add('bbrd-hide-line');
  }
  // Visibility inside a collapsed test is handled by CSS :has(+ .bbrd-test-collapsed)
  // so expanding the test shows the pill again without a rescan.
  fold.classList.remove('bbrd-test-collapsed');
}

function foldCommentRuns(article, path) {
  const rows = [...article.querySelectorAll('[data-key="code-line"]')];
  /** @type {HTMLElement[][]} */
  const runs = [];
  /** @type {HTMLElement[]} */
  let current = [];
  for (const row of rows) {
    if (isFoldedCommentRow(row)) current.push(row);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  const signature = runs.map((run) => run.length).join(',');
  const existing = [...article.querySelectorAll('.bbrd-comment-fold')];
  // Bitbucket may rewrite row className while leaving our fold buttons and mask
  // markers in place. Re-apply hide/open whenever the run shape still matches.
  if (article.getAttribute('data-bbrd-folds') === signature && existing.length === runs.length) {
    const hidden = runs.every((run) => run.every((row) => row.classList.contains('bbrd-hide-line')));
    if (hidden) {
      runs.forEach((run, index) => syncCommentFold(existing[index], run, foldKey(path, index, run)));
      return;
    }
  }
  for (const fold of existing) fold.remove();
  runs.forEach((run, index) => {
    const key = foldKey(path, index, run);
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'bbrd-comment-fold