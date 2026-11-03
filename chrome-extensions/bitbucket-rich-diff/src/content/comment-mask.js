import { classifyDiffRows, classifySideBySideRows, commentLanguage } from '../core/comments.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const WRAP = 'data-bbrd-wrap';

/** Removes comment masking so a file can be re-scanned or shown in full. */
export function clearCommentMasks(root) {
  for (const row of root.querySelectorAll('.bbrd-hide-line')) row.classList.remove('bbrd-hide-line');
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
  const active = settings.hideCodeComments || settings.hideSummaryComments;
  for (const article of findFileDiffs(root)) {
    const language = commentLanguage(getFilePath(article));
    const rows = [...article.querySelectorAll('[data-key="code-line"]')];
    const signature = active && language ? `${settings.hideCodeComments}/${settings.hideSummaryComments}/${rows.length}/${textSize(rows)}` : 'off';
    // Syntax highlighting rewrites the cell after we mask it. The line text stays the
    // same, so the signature matches, but the mask marker is gone and has to be put back.
    if (article.getAttribute('data-bbrd-comments') === signature && masksIntact(rows)) continue;
    clearCommentMasks(article);
    if (signature !== 'off') maskArticle(rows, language, settings);
    article.setAttribute('data-bbrd-comments', signature);
  }
}

function masksIntact(rows) {
  return rows.every((row) => [...row.querySelectorAll('[data-line-type]')].every((cell) => cell.querySelector('[data-bbrd-mask]')));
}

function textSize(rows) {
  let size = 0;
  for (const row of rows) {
    for (const cell of row.querySelectorAll('[data-line-type]')) size += cell.textContent.length;
  }
  return size;
}

/** Bitbucket's highlighter appends a newline that is not part of the source line. */
function sourceText(text) {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function lineTypeOf(cell) {
  const typeAttr = cell.getAttribute('data-line-type');
  return typeAttr === '+' || typeAttr === '-' ? typeAttr : ' ';
}

function lineRoot(cell, row) {
  return cell.closest('[data-qa="code-line"]') || row;
}

function maskArticle(rows, language, settings) {
  const described = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll('[data-line-type]')].map((cell) => ({
      cell,
      line: lineRoot(cell, row),
      type: lineTypeOf(cell),
      text: sourceText(cell.textContent ?? ''),
    }));
    if (cells.length) described.push({ row, cells });
  }
  if (described.some((row) => row.cells.length > 1)) maskSideBySide(described, language, settings);
  else maskUnified(described, language, settings);
}

function maskUnified(described, language, settings) {
  const classified = classifyDiffRows(
    described.map((row) => ({ type: row.cells[0].type, text: row.cells[0].text })),
    language,
    settings,
  );
  described.forEach((row, index) => {
    applyCell(row.cells[0], classified[index]);
    if (classified[index].hideLine) row.row.classList.add('bbrd-hide-line');
  });
}

function maskSideBySide(described, language, settings) {
  const classified = classifySideBySideRows(
    described.map((row) => ({ cells: row.cells.map((cell) => ({ type: cell.type, text: cell.text })) })),
    language,
    settings,
  );
  described.forEach((row, index) => {
    const results = classified[index];
    let allHidden = results.length > 0;
    row.cells.forEach((cell, cellIndex) => {
      applyCell(cell, results[cellIndex]);
      if (!results[cellIndex].hideLine) allHidden = false;
    });
    if (allHidden) row.row.classList.add('bbrd-hide-line');
  });
}

function applyCell(entry, result) {
  entry.line.classList.toggle('bbrd-hide-line', result.hideLine);
  if (!result.hideLine) maskCell(entry.cell, result.intervals);
  const mark = document.createElement('span');
  mark.setAttribute('data-bbrd-mask', '');
  mark.hidden = true;
  entry.cell.append(mark);
}
