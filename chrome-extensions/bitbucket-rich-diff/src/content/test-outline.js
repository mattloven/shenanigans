import { commentLanguage } from '../core/comments.js';
import { findTestSpans, isTestFile } from '../core/test-outline.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

/** @type {Set<string>} */
const openTests = new Set();

/** Collapses each test in a test file to its title and line counts. Safe to call on every scan. */
export function mountTestOutlines(root) {
  for (const article of findFileDiffs(root)) {
    const path = getFilePath(article);
    const language = commentLanguage(path);
    if (!isTestFile(path) || !language) {
      clearOutline(article);
      continue;
    }
    const rows = [...article.querySelectorAll('[data-key="code-line"]')];
    const lines = rows.map(describeRow);
    const spans = findTestSpans(lines, language);
    const signature = spans.map((span) => `${span.start}:${span.title}`).join('|');
    if (article.getAttribute('data-bbrd-outline') === signature && article.querySelectorAll('.bbrd-test-fold').length === spans.length) continue;
    clearOutline(article);
    spans.forEach((span, index) => applySpan(path, rows, lines, span, index));
    article.setAttribute('data-bbrd-outline', signature);
  }
}

function describeRow(row) {
  const cells = [...row.querySelectorAll('[data-line-type]')];
  const added = cells.some((cell) => cell.getAttribute('data-line-type') === '+');
  const removed = cells.some((cell) => cell.getAttribute('data-line-type') === '-');
  const cell = cells.find((item) => item.getAttribute('data-line-type') === '+')
    || cells.find((item) => item.getAttribute('data-line-type') !== ' ')
    || cells[0];
  const raw = cell?.textContent ?? '';
  return { text: raw.endsWith('\n') ? raw.slice(0, -1) : raw, added, removed };
}

function clearOutline(article) {
  article.removeAttribute('data-bbrd-outline');
  for (const fold of article.querySelectorAll('.bbrd-test-fold')) fold.remove();
  for (const node of article.querySelectorAll('.bbrd-test-collapsed')) node.classList.remove('bbrd-test-collapsed');
}

function applySpan(path, rows, lines, span, index) {
  const start = rows[span.start];
  const end = rows[span.end];
  if (!start || !end || !start.parentElement) return;
  let added = 0;
  let removed = 0;
  for (let line = span.start; line <= span.end; line += 1) {
    if (lines[line].added) added += 1;
    if (lines[line].removed) removed += 1;
  }
  const key = `${path}\n${index}\n${span.title}`;
  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'bbrd-test-fold';
  const title = document.createElement('span');
  title.className = 'bbrd-test-title';
  title.textContent = span.title;
  const stat = document.createElement('span');
  stat.className = 'bbrd-test-stat';
  stat.textContent = `+${added} −${removed}`;
  fold.append(title, stat);
  const nodes = nodesInSpan(start, end);
  const open = openTests.has(key);
  fold.setAttribute('aria-expanded', open ? 'true' : 'false');
  for (const node of nodes) node.classList.toggle('bbrd-test-collapsed', !open);
  fold.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = fold.getAttribute('aria-expanded') !== 'true';
    fold.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) openTests.add(key);
    else openTests.delete(key);
    for (const node of nodes) node.classList.toggle('bbrd-test-collapsed', !next);
  });
  start.parentElement.insertBefore(fold, start);
}

function nodesInSpan(start, end) {
  /** @type {HTMLElement[]} */
  const nodes = [];
  let node = start;
  while (node) {
    nodes.push(node);
    if (node === end) break;
    node = node.nextElementSibling;
  }
  return nodes;
}
