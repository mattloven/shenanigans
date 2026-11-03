import { compileHidePattern, isHiddenFile, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const COG_NAME = 'Global diff settings';
const MENU_LABEL = 'Hide files and comments';

/** @type {WeakMap<HTMLElement, (key: string, value: unknown) => void>} */
const changeHandlers = new WeakMap();
/** @type {WeakSet<Document>} */
const wiredDocuments = new WeakSet();

/**
 * Puts one Hide menu immediately to the left of Bitbucket's Files changed cog and hides matching
 * files in the list and the diff. Safe to call on every scan: a re-rendered toolbar is given the
 * same menu, and any older copy is removed.
 *
 * @param {ParentNode} root
 * @param {import('../core/settings.js').Settings} settings
 * @param {(key: string, value: unknown) => void} onChange
 * @returns {number} how many files are hidden
 */
export function mountFileFilters(root, settings, onChange) {
  const doc = documentOf(root);
  ensureDismiss(doc);
  const cog = findCog(root);
  if (cog?.parentElement) {
    const host = ensureHost(doc, cog);
    const panel = ensurePanel(doc, onChange);
    for (const extra of doc.querySelectorAll('.bbrd-menu-host')) {
      if (extra !== host) extra.remove();
    }
    for (const extra of doc.querySelectorAll('.bbrd-filters')) {
      if (extra !== panel) extra.remove();
    }
    if (host.parentElement !== cog.parentElement || host.nextElementSibling !== cog) {
      cog.parentElement.insertBefore(host, cog);
    }
    if (panel.parentElement !== doc.body) doc.body.append(panel);
    syncPanel(panel, settings);
    if (!panel.hidden) placeMenu(host, panel);
  } else {
    removeLegacyPanels(doc);
  }
  return applyHidden(root, settings);
}

function documentOf(root) {
  if (root.nodeType === 9) return /** @type {Document} */ (root);
  return root.ownerDocument ?? document;
}

function findCog(root) {
  if (!root.querySelectorAll) return null;
  let match = null;
  for (const button of root.querySelectorAll('button')) {
    if (!(button instanceof HTMLButtonElement)) continue;
    if (button.closest('.bbrd-menu-host, [role="dialog"]')) continue;
    if (!buttonName(button).includes(COG_NAME)) continue;
    if (!isShown(button)) continue;
    match = button;
  }
  return match;
}

function buttonName(button) {
  return `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''} ${button.textContent ?? ''}`.replace(/\s+/g, ' ');
}

function isShown(element) {
  if (!element.isConnected) return false;
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  }
  return true;
}

function ensureHost(doc, cog) {
  const existing = doc.querySelector('.bbrd-menu-host');
  if (existing) return existing;
  const host = buildHost(doc);
  cog.parentElement.insertBefore(host, cog);
  return host;
}

function ensurePanel(doc, onChange) {
  let panel = doc.body?.querySelector(':scope > .bbrd-filters');
  if (!panel) {
    panel = buildPanel();
    doc.body.append(panel);
  }
  changeHandlers.set(panel, onChange);
  return panel;
}

function removeLegacyPanels(doc) {
  for (const panel of doc.querySelectorAll('.bbrd-filters')) {
    if (panel.parentElement !== doc.body) panel.remove();
  }
  const panels = [...doc.querySelectorAll('body > .bbrd-filters')];
  for (const extra of panels.slice(1)) extra.remove();
  const hosts = [...doc.querySelectorAll('.bbrd-menu-host')];
  for (const extra of hosts.slice(1)) extra.remove();
}

function buildHost(doc) {
  const host = doc.createElement('div');
  host.className = 'bbrd-menu-host';
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'bbrd-menu-button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'bbrd-hide-menu');
  button.setAttribute('aria-label', MENU_LABEL);
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1.2 2.4A1 1 0 0 1 2.1 2h11.8a1 1 0 0 1 .76 1.65L10 8.7V13a1 1 0 0 1-1.45.9l-2-1A1 1 0 0 1 6 12V8.7L1.34 3.65A1 1 0 0 1 1.2 2.4z"/></svg>`;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const panel = doc.getElementById('bbrd-hide-menu');
    if (!panel) return;
    if (panel.hidden) openMenu(doc);
    else closeMenu(doc);
  });
  host.append(button);
  return host;
}

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'bbrd-hide-menu';
  panel.className = 'bbrd-filters';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', MENU_LABEL);
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bbrd-filters-head"><span>Hide</span><span class="bbrd-hidden-count" aria-live="polite"></span></div>
    <label class="bbrd-check" title="Also hides .markdown and the other markdown extensions"><input type="checkbox" data-filter="hideMarkdown" /> Markdown files</label>
    <label class="bbrd-check" title="Line comments and block comments"><input type="checkbox" data-filter="hideCodeComments" /> Code comments</label>
    <label class="bbrd-check" title="C# documentation comments and JSDoc blocks"><input type="checkbox" data-filter="hideSummaryComments" /> Summary comments</label>
    <p class="bbrd-hint">JavaScript, TypeScript and C#</p>
    <label class="bbrd-check" title="Folders ending in Tests, such as Foo.Tests and Foo.UnitTests, and every file inside them"><input type="checkbox" data-filter="hideTestFolders" /> Test projects</label>
    <label class="bbrd-ext">Extensions <input type="text" data-filter="hiddenExtensions" placeholder="svg, lock, min.js" spellcheck="false" /></label>
    <label class="bbrd-ext">Pattern <input type="text" data-filter="hidePattern" placeholder="\\.Tests|tmp/" spellcheck="false" /></label>
    <p class="bbrd-hint">Regular expression. Matches the path, a folder, or the file name.</p>`;
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const input = event.target.closest('[data-filter]');
    if (!input) return;
    const key = input.dataset.filter;
    const value = key === 'hiddenExtensions' ? parseExtensions(input.value) : key === 'hidePattern' ? input.value : input.checked;
    changeHandlers.get(panel)?.(key, value);
  });
  return panel;
}

function ensureDismiss(doc) {
  if (wiredDocuments.has(doc)) return;
  wiredDocuments.add(doc);
  doc.addEventListener('pointerdown', (event) => {
    const panel = doc.getElementById('bbrd-hide-menu');
    const host = doc.querySelector('.bbrd-menu-host');
    if (!panel || panel.hidden) return;
    const target = event.target;
    if (target instanceof Node && (host?.contains(target) || panel.contains(target))) return;
    closeMenu(doc);
  }, true);
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const panel = doc.getElementById('bbrd-hide-menu');
    if (!panel || panel.hidden) return;
    event.stopPropagation();
    closeMenu(doc);
  }, true);
  doc.defaultView?.addEventListener('resize', () => reposition(doc));
  doc.addEventListener('scroll', () => reposition(doc), true);
}

function openMenu(doc) {
  const host = doc.querySelector('.bbrd-menu-host');
  const panel = doc.getElementById('bbrd-hide-menu');
  if (!host || !panel) return;
  panel.hidden = false;
  host.querySelector('.bbrd-menu-button')?.setAttribute('aria-expanded', 'true');
  placeMenu(host, panel);
}

function closeMenu(doc) {
  const panel = doc.getElementById('bbrd-hide-menu');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  doc.querySelector('.bbrd-menu-button')?.setAttribute('aria-expanded', 'false');
}

function reposition(doc) {
  const host = doc.querySelector('.bbrd-menu-host');
  const panel = doc.getElementById('bbrd-hide-menu');
  if (!host || !panel || panel.hidden) return;
  placeMenu(host, panel);
}

function placeMenu(host, panel) {
  const button = host.querySelector('.bbrd-menu-button');
  if (!button) return;
  const rect = button.getBoundingClientRect();
  const view = host.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1024;
  const viewportHeight = view?.innerHeight ?? 768;
  const width = 280;
  const margin = 8;
  const unlaid = rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0;
  const offscreen = rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth;
  if (!unlaid && offscreen) {
    closeMenu(host.ownerDocument);
    return;
  }
  let left = rect.right - width;
  if (left < margin) left = margin;
  if (left + width > viewportWidth - margin) left = Math.max(margin, viewportWidth - width - margin);
  let top = rect.bottom + 4;
  const height = panel.getBoundingClientRect().height || panel.scrollHeight;
  if (height && top + height > viewportHeight - margin) top = Math.max(margin, viewportHeight - height - margin);
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function syncPanel(panel, settings) {
  const markdown = panel.querySelector('[data-filter="hideMarkdown"]');
  const code = panel.querySelector('[data-filter="hideCodeComments"]');
  const summary = panel.querySelector('[data-filter="hideSummaryComments"]');
  const tests = panel.querySelector('[data-filter="hideTestFolders"]');
  if (markdown.checked !== settings.hideMarkdown) markdown.checked = settings.hideMarkdown;
  if (code.checked !== settings.hideCodeComments) code.checked = settings.hideCodeComments;
  if (summary.checked !== settings.hideSummaryComments) summary.checked = settings.hideSummaryComments;
  if (tests.checked !== settings.hideTestFolders) tests.checked = settings.hideTestFolders;
  const extensions = panel.querySelector('[data-filter="hiddenExtensions"]');
  const text = settings.hiddenExtensions.join(', ');
  if (document.activeElement !== extensions && extensions.value !== text) extensions.value = text;
  const pattern = panel.querySelector('[data-filter="hidePattern"]');
  if (document.activeElement !== pattern && pattern.value !== settings.hidePattern) pattern.value = settings.hidePattern;
  const invalid = settings.hidePattern.trim() !== '' && !compileHidePattern(settings.hidePattern);
  pattern.setAttribute('aria-invalid', invalid ? 'true' : 'false');
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
  const count = root.querySelector?.('.bbrd-filters .bbrd-hidden-count') ?? document.querySelector('.bbrd-filters .bbrd-hidden-count');
  if (count) {
    const text = hidden === 0 ? '' : `${hidden} hidden`;
    if (count.textContent !== text) count.textContent = text;
  }
  return hidden;
}

function setHidden(element, hide) {
  if (element.classList.contains('bbrd-file-hidden') !== hide) element.classList.toggle('bbrd-file-hidden', hide);
}
