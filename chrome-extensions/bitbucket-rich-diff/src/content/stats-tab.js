import { commentLanguage } from '../core/comments.js';
import { formatCount, pathFromFileLink } from '../core/file-filter.js';
import { summarizeFiles } from '../core/pr-stats.js';
import { findTestSpans, isTestFile } from '../core/test-outline.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const TITLE = '💩 Betterer Bit Bucket';

const FIGURES = [
  ['files', 'Files'],
  ['lines', 'Lines'],
  ['markdown', 'Markdown'],
  ['tests', 'Tests'],
  ['projects', 'Project files'],
  ['generated', 'Generated'],
  ['comments', 'Comments'],
];

/**
 * Puts the summary above the file tree and the diff on Files changed.
 * Line totals come from Bitbucket's own "Lines updated" figure.
 * Safe to call on every scan.
 */
export function mountStatsTab(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  doc.querySelector('.bbrd-stats-tab')?.remove();
  const split = findSplit(root);
  if (!split?.parentElement) {
    doc.querySelector('.bbrd-stats')?.remove();
    return;
  }
  const panel = ensurePanel(doc);
  for (const extra of doc.querySelectorAll('.bbrd-stats')) {
    if (extra !== panel) extra.remove();
  }
  if (split.previousElementSibling !== panel) split.parentElement.insertBefore(panel, split);
  const summary = summarizeFiles(filesIn(root));
  const lines = readLinesUpdated(root);
  summary.added = lines ? lines.added : null;
  summary.removed = lines ? lines.removed : null;
  const comments = readComments(root);
  summary.comments = comments ? comments.unresolved : null;
  summary.commentsResolved = comments ? comments.resolved : null;
  fillPanel(panel, summary);
}

export function clearStats(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  delete doc.__bbrdCommentRatio;
  doc.querySelector('.bbrd-stats-tab')?.remove();
  doc.querySelector('.bbrd-stats')?.remove();
}

/** The flex row whose children are the file tree and the diff preview. */
function findSplit(root) {
  if (!root.querySelectorAll) return null;
  const tree = root.querySelector('#file-tree');
  const marker = tree || linesHeading(root);
  if (!marker?.parentElement) return null;
  let node = marker;
  while (node.parentElement) {
    const parent = node.parentElement;
    if (parent === root || parent === root.body) break;
    const children = [...parent.children].filter((child) => !child.classList?.contains('bbrd-stats'));
    const treeChild = children.find((child) => child.contains(marker));
    const previewChild = children.find((child) => child !== treeChild && child.querySelector('article[data-qa="branch-diff-file"]'));
    if (treeChild && previewChild) return parent;
    node = parent;
  }
  return null;
}

function linesHeading(root) {
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((el) => {
    if (el.closest('.bbrd-stats')) return false;
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Lines updated';
  });
}

/**
 * The comments menu shows "Unresolved Comments (7)" and, at the bottom, "Resolved Comments (0)".
 * Bitbucket removes those headings when the menu closes, so the last pair is kept until the
 * unresolved total on the button changes. File-row phrases are not the total.
 */
function readComments(root) {
  if (!root.querySelectorAll) return null;
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  let unresolved = null;
  let resolved = null;
  for (const el of root.querySelectorAll('div, span, button, a, h1, h2, h3, h4, h5, h6')) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest('.bbrd-stats, .bbrd-filters, #file-tree')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > 48) continue;
    const unresolvedHeading = text.match(/^unresolved\s+comments\s*\(\s*([\d,]+)\s*\)$/i);
    const resolvedHeading = text.match(/^resolved\s+comments\s*\(\s*([\d,]+)\s*\)$/i);
    const button = text.match(/^comments\s*\(\s*([\d,]+)\s+unresolved\s*\)$/i);
    if (unresolvedHeading) unresolved = countOf(unresolvedHeading[1]);
    else if (resolvedHeading) resolved = countOf(resolvedHeading[1]);
    else if (button && unresolved == null) unresolved = countOf(button[1]);
  }
  if (unresolved == null) return null;
  if (resolved != null) doc.__bbrdCommentRatio = { unresolved, resolved };
  else if (doc.__bbrdCommentRatio?.unresolved === unresolved) resolved = doc.__bbrdCommentRatio.resolved;
  else delete doc.__bbrdCommentRatio;
  return { unresolved, resolved };
}

function countOf(raw) {
  return Number(raw.replaceAll(',', ''));
}

/** Bitbucket prints the pull request totals next to the "Lines updated" label in the file tree. */
function readLinesUpdated(root) {
  const heading = linesHeading(root);
  const row = heading?.parentElement?.parentElement;
  const text = (row?.textContent ?? '').replace(/\s+/g, ' ');
  const added = text.match(/\+\s*([\d,]+)/);
  const removed = text.match(/[-\u2212]\s*([\d,]+)/);
  if (!added || !removed) return null;
  return {
    added: Number(added[1].replaceAll(',', '')),
    removed: Number(removed[1].replaceAll(',', '')),
  };
}

function ensurePanel(doc) {
  let panel = doc.querySelector('.bbrd-stats');
  if (!panel) {
    panel = doc.createElement('section');
    panel.className = 'bbrd-stats';
  }
  panel.setAttribute('aria-label', 'Betterer Bit Bucket');
  panel.hidden = false;
  if (!panel.querySelector('.bbrd-stats-actions')) {
    const head = doc.createElement('div');
    head.className = 'bbrd-stats-head';
    const heading = doc.createElement('h2');
    heading.textContent = TITLE;
    const actions = doc.createElement('div');
    actions.className = 'bbrd-stats-actions';
    head.append(heading, actions);
    const lead = doc.createElement('p');
    lead.className = 'bbrd-stats-lead';
    const grid = doc.createElement('div');
    grid.className = 'bbrd-stats-grid';
    for (const [key, label] of FIGURES) grid.append(figure(doc, key, label));
    panel.replaceChildren(head, lead, grid);
  }
  const grid = panel.querySelector('.bbrd-stats-grid');
  if (grid) {
    for (const [key, label] of FIGURES) {
      if (panel.querySelector(`[data-stat="${key}"]`)) continue;
      grid.append(figure(doc, key, label));
    }
  }
  const heading = panel.querySelector('h2');
  if (heading && heading.textContent !== TITLE) heading.textContent = TITLE;
  return panel;
}

function figure(doc, key, label) {
  const item = doc.createElement('div');
  item.className = 'bbrd-stats-figure';
  item.dataset.stat = key;
  const value = doc.createElement('strong');
  const caption = doc.createElement('span');
  caption.textContent = label;
  item.append(value, caption);
  return item;
}

function filesIn(root) {
  /** @type {Map<string, { path: string, added: number, removed: number, tests: number }>} */
  const byPath = new Map();
  if (!root.querySelectorAll) return [];
  for (const link of root.querySelectorAll('a[href*="#chg-"]')) {
    const path = pathFromFileLink(link.getAttribute('href'));
    if (!path || byPath.has(path)) continue;
    byPath.set(path, { path, added: 0, removed: 0, tests: 0 });
  }
  for (const article of findFileDiffs(root)) {
    const path = getFilePath(article);
    if (!path) continue;
    const entry = byPath.get(path) ?? { path, added: 0, removed: 0, tests: 0 };
    entry.tests = testsIn(article, path);
    byPath.set(path, entry);
  }
  return [...byPath.values()];
}

function testsIn(article, path) {
  const language = commentLanguage(path);
  if (!language || !isTestFile(path)) return 0;
  const lines = [...article.querySelectorAll('[data-key="code-line"]')].map((row) => {
    const cells = [...row.querySelectorAll('[data-line-type]')];
    const cell = cells.find((item) => item.getAttribute('data-line-type') === '+')
      || cells.find((item) => item.getAttribute('data-line-type') !== ' ')
      || cells[0];
    const raw = cell?.textContent ?? '';
    return { text: raw.endsWith('\n') ? raw.slice(0, -1) : raw };
  });
  return findTestSpans(lines, language).length;
}

function fillPanel(panel, summary) {
  const tests = summary.testFiles === 1 ? '1 file' : `${summary.testFiles} files`;
  const testWord = summary.tests === 1 ? '1 test' : `${summary.tests} tests`;
  const values = {
    files: String(summary.files),
    markdown: String(summary.markdown),
    tests: `${tests} · ${testWord}`,
    projects: String(summary.projects),
    generated: String(summary.generated),
    comments: commentLabel(summary),
  };
  for (const [key, value] of Object.entries(values)) {
    const slot = panel.querySelector(`[data-stat="${key}"] strong`);
    if (slot && slot.textContent !== value) slot.textContent = value;
  }
  const lines = panel.querySelector('[data-stat="lines"] strong');
  if (lines) setLineCounts(lines, summary.added, summary.removed);
  const lead = panel.querySelector('.bbrd-stats-lead');
  if (lead) setLead(lead, summary, tests, testWord);
}

function commentLabel(summary) {
  if (summary.comments == null) return '—';
  if (summary.commentsResolved == null) return `${formatCount(summary.comments)} unresolved`;
  const total = summary.commentsResolved + summary.comments;
  return `${formatCount(summary.commentsResolved)} / ${formatCount(total)} resolved`;
}

function setLineCounts(slot, added, removed) {
  if (added == null || removed == null) {
    if (slot.textContent !== '—') slot.textContent = '—';
    return;
  }
  let add = slot.querySelector('.bbrd-add');
  let del = slot.querySelector('.bbrd-del');
  if (!add || !del) {
    slot.replaceChildren();
    add = slot.ownerDocument.createElement('span');
    add.className = 'bbrd-add';
    del = slot.ownerDocument.createElement('span');
    del.className = 'bbrd-del';
    slot.append(add, slot.ownerDocument.createTextNode(' '), del);
  }
  const addText = `+${formatCount(added)}`;
  const delText = `−${formatCount(removed)}`;
  if (add.textContent !== addText) add.textContent = addText;
  if (del.textContent !== delText) del.textContent = delText;
}

function setLead(lead, summary, tests, testWord) {
  let add = lead.querySelector('.bbrd-add');
  let del = lead.querySelector('.bbrd-del');
  let prefix = lead.querySelector('[data-part="prefix"]');
  let suffix = lead.querySelector('[data-part="suffix"]');
  if (!add || !del || !prefix || !suffix) {
    lead.replaceChildren();
    prefix = lead.ownerDocument.createElement('span');
    prefix.dataset.part = 'prefix';
    add = lead.ownerDocument.createElement('span');
    add.className = 'bbrd-add';
    del = lead.ownerDocument.createElement('span');
    del.className = 'bbrd-del';
    suffix = lead.ownerDocument.createElement('span');
    suffix.dataset.part = 'suffix';
    lead.append(prefix, add, lead.ownerDocument.createTextNode(' '), del, suffix);
  }
  const commentText = summary.comments == null
    ? ''
    : summary.commentsResolved == null
      ? `, ${formatCount(summary.comments)} unresolved ${summary.comments === 1 ? 'comment' : 'comments'}`
      : `, ${formatCount(summary.commentsResolved)} / ${formatCount(summary.commentsResolved + summary.comments)} resolved`;
  const prefixText = `${summary.files} files changed, `;
  const suffixText = `. ${summary.markdown} markdown, ${tests} with ${testWord}${commentText}.`;
  const addText = summary.added == null ? '' : `+${formatCount(summary.added)}`;
  const delText = summary.removed == null ? '' : `−${formatCount(summary.removed)}`;
  if (prefix.textContent !== prefixText) prefix.textContent = prefixText;
  if (suffix.textContent !== suffixText) suffix.textContent = suffixText;
  if (add.textContent !== addText) add.textContent = addText;
  if (del.textContent !== delText) del.textContent = delText;
}
