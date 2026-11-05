import { commentLanguage } from '../core/comments.js';
import { pathFromFileLink } from '../core/file-filter.js';
import { summarizeFiles } from '../core/pr-stats.js';
import { findTestSpans, isTestFile } from '../core/test-outline.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const FIGURES = [
  ['files', 'Files'],
  ['lines', 'Lines'],
  ['markdown', 'Markdown'],
  ['tests', 'Tests'],
  ['projects', 'Project files'],
  ['generated', 'Generated'],
];

/** Adds one Stats tab after Commits in the pull request tab list and fills it from the diff. Safe to call on every scan. */
export function mountStatsTab(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  const found = findPrTabBar(root);
  if (!found) return;
  const tab = ensureTab(doc, found.commits);
  const panel = ensurePanel(doc, found.list);
  const summary = summarizeFiles(filesIn(root));
  fillPanel(panel, summary);
  if (tab.getAttribute('aria-selected') !== 'true') panel.hidden = true;
}

export function clearStats(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  doc.querySelector('.bbrd-stats-tab')?.remove();
  doc.querySelector('.bbrd-stats')?.remove();
}

/**
 * The pull request tab list is the horizontal row Overview / Files changed / Commits.
 * The repository sidebar also has a Commits link, and that one comes first in the page.
 * Only a tablist that contains all three pull request tabs qualifies.
 */
function findPrTabBar(root) {
  if (!root.querySelectorAll) return null;
  for (const list of root.querySelectorAll('[role="tablist"]')) {
    if (!(list instanceof HTMLElement)) continue;
    if (list.closest('.bbrd-tabs, .bbrd-stats, .bbrd-filters')) continue;
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter((tab) => tab instanceof HTMLElement && !tab.classList.contains('bbrd-stats-tab'));
    if (!tabs.some((tab) => tabKind(tab) === 'overview')) continue;
    if (!tabs.some((tab) => tabKind(tab) === 'files')) continue;
    const commits = tabs.find((tab) => tabKind(tab) === 'commits');
    if (commits) return { list, commits };
  }
  return null;
}

function tabKind(tab) {
  const href = tab.getAttribute('href') || '';
  const name = `${tab.getAttribute('aria-label') ?? ''} ${tab.textContent ?? ''}`.replace(/\s+/g, ' ').trim();
  if (/\/pull-requests\/[^/]+\/commits\/?(?:$|\?|#)/.test(href) || /^commits/i.test(name)) return 'commits';
  if (/\/pull-requests\/[^/]+\/diff\/?(?:$|\?|#)/.test(href) || /^files?\s+changed/i.test(name) || /^diff\b/i.test(name)) return 'files';
  if (/\/pull-requests\/[^/]+\/overview\/?(?:$|\?|#)/.test(href) || /^overview\b/i.test(name)) return 'overview';
  return '';
}

function ensureTab(doc, commits) {
  let tab = doc.querySelector('.bbrd-stats-tab');
  if (!tab) {
    tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = 'bbrd-stats-tab';
    tab.textContent = 'Stats';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = tab.getAttribute('aria-selected') !== 'true';
      tab.setAttribute('aria-selected', open ? 'true' : 'false');
      const panel = doc.querySelector('.bbrd-stats');
      if (panel) panel.hidden = !open;
    });
  }
  if (commits.nextElementSibling !== tab) commits.insertAdjacentElement('afterend', tab);
  return tab;
}

function ensurePanel(doc, nav) {
  let panel = doc.querySelector('.bbrd-stats');
  if (!panel) {
    panel = doc.createElement('section');
    panel.className = 'bbrd-stats';
    panel.setAttribute('aria-label', 'Pull request stats');
    panel.hidden = true;
    const heading = doc.createElement('h2');
    heading.textContent = 'Stats';
    const lead = doc.createElement('p');
    lead.className = 'bbrd-stats-lead';
    const grid = doc.createElement('div');
    grid.className = 'bbrd-stats-grid';
    for (const [key, label] of FIGURES) {
      const figure = doc.createElement('div');
      figure.className = 'bbrd-stats-figure';
      figure.dataset.stat = key;
      const value = doc.createElement('strong');
      const caption = doc.createElement('span');
      caption.textContent = label;
      figure.append(value, caption);
      grid.append(figure);
    }
    panel.append(heading, lead, grid);
  }
  if (nav.nextElementSibling !== panel) nav.insertAdjacentElement('afterend', panel);
  return panel;
}

function filesIn(root) {
  /** @type {Map<string, { path: string, added: number, removed: number, tests: number }>} */
  const byPath = new Map();
  if (!root.querySelectorAll) return [];
  for (const link of root.querySelectorAll('a[href*="#chg-"]')) {
    const path = pathFromFileLink(link.getAttribute('href'));
    if (!path || byPath.has(path)) continue;
    const row = link.closest('li') ?? link;
    const text = row.textContent ?? '';
    byPath.set(path, {
      path,
      added: sumPhrase(text, /(\d+)\s+lines?\s+added/gi),
      removed: sumPhrase(text, /(\d+)\s+lines?\s+removed/gi),
      tests: 0,
    });
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

function sumPhrase(text, pattern) {
  let total = 0;
  for (const match of text.matchAll(pattern)) total += Number(match[1]);
  return total;
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

function setLineCounts(slot, added, removed) {
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
  const addText = `+${added}`;
  const delText = `−${removed}`;
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
  const prefixText = `${summary.files} files changed, `;
  const suffixText = `. ${summary.markdown} markdown, ${tests} with ${testWord}.`;
  const addText = `+${summary.added}`;
  const delText = `−${summary.removed}`;
  if (prefix.textContent !== prefixText) prefix.textContent = prefixText;
  if (suffix.textContent !== suffixText) suffix.textContent = suffixText;
  if (add.textContent !== addText) add.textContent = addText;
  if (del.textContent !== delText) del.textContent = delText;
}
