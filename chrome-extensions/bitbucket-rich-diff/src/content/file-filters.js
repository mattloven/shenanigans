import { isHiddenFile, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

/**
 * Injects the filter bar at the top of Bitbucket's file list and hides matching files both in
 * the list and in the diff. Safe to call on every scan: the bar is only inserted once, and
 * classes are only touched when they need to change.
 *
 * @param {ParentNode} root
 * @param {import('../core/settings.js').Settings} settings
 * @param {(key: string, value: unknown) => void} onChange
 * @returns {number} how many files are hidden
 */
export function mountFileFilters(root, settings, onChange) {
  const list = findFileList(root);
  if (list) ensurePanel(list, settings, onChange);
  return applyHidden(root, settings);
}

function findFileList(root) {
  const link = root.querySelector('a[href*="#chg-"]');
  return link?.closest('ul') ?? null;
}

function ensurePanel(list, settings, onChange) {
  let panel = list.parentElement.querySelector(':scope > .bbrd-filters');
  if (!panel) {
    panel = buildPanel(onChange);
    list.parentElement.insertBefore(panel, list);
  }
  const markdown = panel.querySelector('[data-filter="hideMarkdown"]');
  const code = panel.querySelector('[data-filter="hideCodeComments"]');
  const summary = panel.querySelector('[data-filter="hideSummaryComments"]');
  if (markdown.checked !== settings.hideMarkdown) markdown.checked = settings.hideMarkdown;
  if (code.checked !== settings.hideCodeComments) code.checked = settings.hideCodeComments;
  if (summary.checked !== settings.hideSummaryComments) summary.checked = settings.hideSummaryComments;
  const extensions = panel.querySelector('[data-filter="hiddenExtensions"]');
  const text = settings.hiddenExtensions.join(', ');
  if (document.activeElement !== extensions && extensions.value !== text) extensions.value = text;
  return panel;
}

function buildPanel(onChange) {
  const panel = document.createElement('div');
  panel.className = 'bbrd-filters';
  panel.innerHTML = `
    <div class="bbrd-filters-head"><span>Hide</span><span class="bbrd-hidden-count" aria-live="polite"></span></div>
    <label class="bbrd-check" title="Also hides .markdown and the other markdown extensions"><input type="checkbox" data-filter="hideMarkdown" /> Markdown files</label>
    <label class="bbrd-check" title="Line comments and block comments"><input type="checkbox" data-filter="hideCodeComments" /> Code comments</label>
    <label class="bbrd-check" title="C# documentation comments and JSDoc blocks"><input type="checkbox" data-filter="hideSummaryComments" /> Summary comments</label>
    <p class="bbrd-hint">JavaScript, TypeScript and C#</p>
    <label class="bbrd-ext">Extensions <input type="text" data-filter="hiddenExtensions" placeholder="svg, lock, min.js" spellcheck="false" /></label>`;
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const input = event.target.closest('[data-filter]');
    if (!input) return;
    const key = input.dataset.filter;
    const value = key === 'hiddenExtensions' ? parseExtensions(input.value) : input.checked;
    onChange(key, value);
  });
  return panel;
}

function applyHidden(root, settings) {
  let hidden = 0;
  const seen = new Set();
  for (const link of root.querySelectorAll('a[href*="#chg-"]')) {
    const path = pathFromFileLink(link.getAttribute('href'));
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const item = link.closest('li') ?? link;
    const hide = isHiddenFile(path, settings);
    if (hide) hidden += 1;
    setHidden(item, hide);
  }
  for (const article of findFileDiffs(root)) {
    setHidden(article, isHiddenFile(getFilePath(article), settings));
  }
  const count = root.querySelector('.bbrd-filters .bbrd-hidden-count');
  if (count) {
    const text = hidden === 0 ? '' : `${hidden} hidden`;
    if (count.textContent !== text) count.textContent = text;
  }
  return hidden;
}

function setHidden(element, hide) {
  if (element.classList.contains('bbrd-file-hidden') !== hide) element.classList.toggle('bbrd-file-hidden', hide);
}
