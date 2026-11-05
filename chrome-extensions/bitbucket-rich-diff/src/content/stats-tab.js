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

/** Adds one Stats tab after Commits and fills it from the files currently in the diff. Safe to call on every scan. */
export function mountStatsTab(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  const commits = findCommitsTab(root);
  if (!commits?.parentElement) return;
  const tab = ensureTab(doc, commits);
  const panel = ensurePanel(doc, commits.parentElement);
  const summary = summarizeFiles(filesIn(root));
  fillPanel(panel, summary);
  if (tab.getAttribute('aria-expanded') !== 'true') panel.hidden = true;
}

export function clearStats(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  doc.querySelector('.bbrd-stats-tab')?.remove();
  doc.querySelector('.bbrd-stats')?.remove();
}

function findCommitsTab(root) {
  if (!root.querySelectorAll) return null;
  for (const node of root.querySelectorAll('a, button, [role="tab"]')) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList.contains('bbrd-stats-tab') || node.closest('.bbrd-stats, .bbrd-filters')) continue;
    const href = node.getAttribute('href') || '';
    const name = `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`.replace(/\s+/g, ' ').trim();
    if (/\/commits\/?(?:$|\?|#)/.test(href) || /^commits\b/i.test(name)) return node;
  }
  return null;
}

function ensureTab(doc, commits) {
  let tab = doc.querySelector('.bbrd-stats-tab');
  if (!tab) {
    tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = 'bbrd-stats-tab';
    tab.textContent = 'Stats';
    tab.setAttribute('aria-expanded', 'false');
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = tab.getAttribute('aria-expanded') !== 'true';
      tab.setAttribute('aria-expanded', open ? 'true' : 'false');
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
  const lines = `+${summary.added} −${summary.removed}`;
  const tests = summary.testFiles === 1 ? '1 file' : `${summary.testFiles} files`;
  const testWord = summary.tests === 1 ? '1 test' : `${summary.tests} tests`;
  const values = {
    files: String(summary.files),
    lines,
    markdown: String(summary.markdown),
    tests: `${tests} · ${testWord}`,
    projects: String(summary.projects),
    generated: String(summary.generated),
  };
  for (const [key, value] of Object.entries(values)) {
    const slot = panel.querySelector(`[data-stat="${key}"] strong`);
    if (slot && slot.textContent !== value) slot.textContent = value;
  }
  const lead = panel.querySelector('.bbrd-stats-lead');
  const sentence = `${summary.files} files changed, ${lines}. ${summary.markdown} markdown, ${tests} with ${testWord}.`;
  if (lead && lead.textContent !== sentence) lead.textContent = sentence;
}
