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
