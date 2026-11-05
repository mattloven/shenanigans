import { CATEGORY_LABEL, CATEGORY_ORDER, compileHidePattern, fileCategory, formatHideSummary, isHiddenFolder, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const COG_NAME = 'Global diff settings';
const MENU_LABEL = 'Hide files and comments';

/** @type {WeakMap<HTMLElement, (key: string, value: unknown) => void>} */
const changeHandlers = new WeakMap();
/** @type {WeakSet<Document>} */
const wiredDocuments = new WeakSet();

/** Shown again for this visit only. A reload, or opening another pull request, hides them once more. */
let revealed = false;

/** @type {{ root: ParentNode, settings: import('../core/settings.js').Settings, onChange: (key: string, value: unknown) => void, commentOnly: Set<string> } | null} */
let lastApply = null;

/** Forget the temporary Show, so the next pull request starts from the saved hide rules. */
export function resetHiddenReveal() {
  revealed = false;
}

/**
 * Puts one Hide menu immediately to the left of Bitbucket's Files changed cog and hides matching
 * files in the list and the diff. Safe to call on every scan: a re-rendered toolbar is given the
 * same menu, and any older copy is removed.
 *
 * @param {ParentNode} root
 * @param {import('../core/settings.js').Settings} settings
 * @param {(key: string, value: unknown) => void} onChange
 * @param {Set<string>} [commentOnly] files whose whole diff is comments
 * @returns {number} how many files are hidden
 */
export function mountFileFilters(root, settings, onChange, commentOnly = new Set()) {
  lastApply = { root, settings, onChange, commentOnly };
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
  return applyHidden(root, settings, commentOnly);
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
    <label class="bbrd-check" title="Solution files and every project type: .sln, .slnx, .csproj, .fsproj, .vbproj, .vcxproj"><input type="checkbox" data-filter="hideProjects" /> Solution and project files</label>
    <label class="bbrd-check" title="Lockfiles, minified code, and generated source such as Designer.cs"><input type="checkbox" data-filter="hideGenerated" /> Generated files</label>
    <label class="bbrd-check" title="A file whose only changes are comments"><input type="checkbox" data-filter="hideCommentFiles" /> Comment-only files</label>
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
  const projects = panel.querySelector('[data-filter="hideProjects"]');
  const generated = panel.querySelector('[data-filter="hideGenerated"]');
  const commentFiles = panel.querySelector('[data-filter="hideCommentFiles"]');
  if (markdown.checked !== settings.hideMarkdown) markdown.checked = settings.hideMarkdown;
  if (code.checked !== settings.hideCodeComments) code.checked = settings.hideCodeComments;
  if (summary.checked !== settings.hideSummaryComments) summary.checked = settings.hideSummaryComments;
  if (tests.checked !== settings.hideTestFolders) tests.checked = settings.hideTestFolders;
  if (projects.checked !== settings.hideProjects) projects.checked = settings.hideProjects;
  if (generated.checked !== settings.hideGenerated) generated.checked = settings.hideGenerated;
  if (commentFiles.checked !== settings.hideCommentFiles) commentFiles.checked = settings.hideCommentFiles;
  const extensions = panel.querySelector('[data-filter="hiddenExtensions"]');
  const text = settings.hiddenExtensions.join(', ');
  if (document.activeElement !== extensions && extensions.value !== text) extensions.value = text;
  const pattern = panel.querySelector('[data-filter="hidePattern"]');
  if (document.activeElement !== pattern && pattern.value !== settings.hidePattern) pattern.value = settings.hidePattern;
  const invalid = settings.hidePattern.trim() !== '' && !compileHidePattern(settings.hidePattern);
  pattern.setAttribute('aria-invalid', invalid ? 'true' : 'false');
}

function applyHidden(root, settings, commentOnly) {
  /** @type {Partial<Record<import('../core/file-filter.js').HideCategory, number>>} */
  const counts = {};
  for (const key of CATEGORY_ORDER) counts[key] = 0;
  const lines = { added: 0, removed: 0 };
  const seen = new Set();
  for (const link of root.querySelectorAll('a[href*="#chg-"]')) {
    const path = pathFromFileLink(link.getAttribute('href'));
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const item = link.closest('li') ?? link;
    const category = fileCategory(path, settings, commentOnly);
    if (category) {
      counts[category] += 1;
      const stat = readStat(item);
      lines.added += stat.added;
      lines.removed += stat.removed;
    }
    setHidden(item, Boolean(category) && !revealed);
    syncChip(item, revealed && category ? category : null);
  }
  for (const article of findFileDiffs(root)) {
    const category = fileCategory(getFilePath(article), settings, commentOnly);
    setHidden(article, Boolean(category) && !revealed);
  }
  markHiddenFolders(root, settings);
  const summary = formatHideSummary(counts, lines);
  const count = root.querySelector?.('.bbrd-filters .bbrd-hidden-count') ?? document.querySelector('.bbrd-filters .bbrd-hidden-count');
  if (count && count.textContent !== summary) count.textContent = summary;
  syncBars(root, summary);
  return CATEGORY_ORDER.reduce((sum, key) => sum + (counts[key] || 0), 0);
}

function readStat(element) {
  const text = element?.innerText ?? '';
  return { added: sumPhrase(text, /(\d+)\s+lines?\s+added/gi), removed: sumPhrase(text, /(\d+)\s+lines?\s+removed/gi) };
}

function sumPhrase(text, pattern) {
  let total = 0;
  for (const match of text.matchAll(pattern)) total += Number(match[1]);
  return total;
}

function syncChip(item, category) {
  let chip = item.querySelector(':scope > .bbrd-cat');
  if (!category) {
    chip?.remove();
    return;
  }
  const label = CATEGORY_LABEL[category];
  if (!chip) {
    chip = item.ownerDocument.createElement('span');
    chip.className = 'bbrd-cat';
    item.append(chip);
  }
  if (chip.textContent !== label) chip.textContent = label;
}

function findFileList(root) {
  const link = root.querySelector?.('a[href*="#chg-"]');
  let list = link?.closest('ul') ?? null;
  while (list?.parentElement?.closest('ul')?.querySelector('a[href*="#chg-"]')) {
    list = list.parentElement.closest('ul');
  }
  return list;
}

function syncBars(root, summary) {
  const doc = documentOf(root);
  if (!summary) {
    for (const bar of doc.querySelectorAll('.bbrd-hidden-bar')) bar.remove();
    return;
  }
  const list = findFileList(root);
  if (list) fillBar(ensureBar(doc, list, 'list'), summary);
  const articles = [...findFileDiffs(root)];
  const last = articles[articles.length - 1];
  if (last) fillBar(ensureBar(doc, last, 'diff'), summary);
}

function ensureBar(doc, anchor, place) {
  let bar = doc.querySelector(`.bbrd-hidden-bar[data-place="${place}"]`);
  if (!bar) {
    bar = doc.createElement('div');
    bar.className = 'bbrd-hidden-bar';
    bar.dataset.place = place;
    const label = doc.createElement('span');
    label.className = 'bbrd-hidden-summary';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'bbrd-hidden-toggle';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealed = !revealed;
      const last = lastApply;
      if (last) mountFileFilters(last.root, last.settings, last.onChange, last.commentOnly);
    });
    bar.append(label, button);
  }
  if (anchor.nextElementSibling !== bar) anchor.insertAdjacentElement('afterend', bar);
  return bar;
}

function fillBar(bar, summary) {
  const label = bar.querySelector('.bbrd-hidden-summary');
  if (label && label.textContent !== summary) label.textContent = summary;
  const button = bar.querySelector('.bbrd-hidden-toggle');
  const text = revealed ? 'Hide' : 'Show';
  const name = revealed ? 'Hide hidden files' : 'Show hidden files';
  if (button && button.textContent !== text) button.textContent = text;
  button?.setAttribute('aria-label', name);
}

function setHidden(element, hide) {
  if (element.classList.contains('bbrd-file-hidden') !== hide) element.classList.toggle('bbrd-file-hidden', hide);
}

function markHiddenFolders(root, settings) {
  if (!root.querySelectorAll) return;
  for (const button of root.querySelectorAll('button')) {
    if (!(button instanceof HTMLButtonElement)) continue;
    if (!button.querySelector('[aria-label="Directory"]')) continue;
    const list = button.closest('ul[role="list"]');
    if (!list?.querySelector('a[href*="#chg-"]')) continue;
    syncFolderPill(button, isHiddenFolder(directoryPath(button), settings));
  }
}

function directoryPath(button) {
  const texts = [...button.querySelectorAll('span')]
    .filter((span) => !span.classList.contains('bbrd-hidden-pill') && !span.querySelector('span, svg'))
    .map((span) => span.textContent.replace(/\s+/g, ' ').trim())
    .filter((text) => text && text !== 'Directory');
  return texts.sort((a, b) => b.length - a.length)[0] ?? '';
}

function syncFolderPill(button, show) {
  const pills = [...button.querySelectorAll('.bbrd-hidden-pill')];
  if (!show) {
    for (const pill of pills) pill.remove();
    return;
  }
  for (const extra of pills.slice(1)) extra.remove();
  if (pills.length > 0) return;
  const pill = button.ownerDocument.createElement('span');
  pill.className = 'bbrd-hidden-pill';
  pill.textContent = 'Hidden';
  pill.title = 'Hidden by Bitbucket Rich Diff';
  button.append(pill);
}
