import { CATEGORY_LABEL, CATEGORY_ORDER, compileHidePattern, fileCategory, formatCount, formatHideSummary, groupCountText, isHiddenFolder, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const MENU_LABEL = 'Hide files and comments';
const VIEWED_COUNTER = /^(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+files?\s+viewed$/i;
const CHANGED_COUNTER = /^(\d[\d,]*)\s+files?\s+changed$/i;
const ORIGINAL_VIEWED = 'bbrdViewedOriginal';
const ORIGINAL_CHANGED = 'bbrdChangedOriginal';

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
 * Puts one Hide menu in the top right of the summary bar and hides matching files in the list
 * and the diff. Safe to call on every scan: a re-rendered bar is given the same menu, and any
 * older copy is removed.
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
  const slot = doc.querySelector('.bbrd-stats-actions');
  if (slot) {
    const host = ensureHost(doc);
    const panel = ensurePanel(doc, onChange);
    for (const extra of doc.querySelectorAll('.bbrd-menu-host')) {
      if (extra !== host) extra.remove();
    }
    for (const extra of doc.querySelectorAll('.bbrd-filters')) {
      if (extra !== panel) extra.remove();
    }
    if (host.parentElement !== slot) slot.append(host);
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

function ensureHost(doc) {
  const existing = doc.querySelector('.bbrd-menu-host');
  if (existing) return existing;
  return buildHost(doc);
}

function ensurePanel(doc, onChange) {
  let panel = doc.body?.querySelector(':scope > .bbrd-filters');
  if (!panel) {
    panel = buildPanel();
    doc.body.append(panel);
  } else {
    parkSummary(panel);
  }
  shapeCommentOptions(panel);
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

/** Keeps an already-open menu in the new shape: the hidden-file summary sits under the options. */
function parkSummary(panel) {
  let foot = panel.querySelector('.bbrd-filters-foot');
  if (!foot) {
    foot = panel.querySelector('.bbrd-hidden-actions');
    if (!foot) return;
    foot.classList.remove('bbrd-hidden-actions');
    foot.classList.add('bbrd-filters-foot');
  }
  if (panel.lastElementChild !== foot) panel.append(foot);
  const head = panel.querySelector('.bbrd-filters-head');
  if (head && head.textContent.replace(/\s+/g, ' ').trim() !== 'Hide') head.textContent = 'Hide';
}

/** Drops the old comment paragraph and adds Collapse summary comments on a menu built earlier. */
function shapeCommentOptions(panel) {
  panel.querySelector('.bbrd-comment-explain')?.remove();
  if (panel.querySelector('[data-filter="collapseSummaryComments"]')) return;
  const summary = panel.querySelector('[data-filter="hideSummaryComments"]')?.closest('label');
  if (!summary) return;
  const label = panel.ownerDocument.createElement('label');
  label.className = 'bbrd-check';
  label.title = 'Folds /// docs and /** JSDoc */ into a section. Unavailable while summary comments are hidden.';
  label.innerHTML = '<input type="checkbox" data-filter="collapseSummaryComments" /> Collapse summary comments';
  summary.insertAdjacentElement('afterend', label);
}

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'bbrd-hide-menu';
  panel.className = 'bbrd-filters';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', MENU_LABEL);
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bbrd-filters-head">Hide</div>
    <label class="bbrd-check" title="Also hides .markdown and the other markdown extensions"><input type="checkbox" data-filter="hideMarkdown" /> Markdown files</label>
    <label class="bbrd-check" title="Line comments and block comments"><input type="checkbox" data-filter="hideCodeComments" /> Code comments</label>
    <label class="bbrd-check" title="C# documentation comments and JSDoc blocks. Removes them, with no section to open."><input type="checkbox" data-filter="hideSummaryComments" /> Summary comments</label>
    <label class="bbrd-check" title="Folds /// docs and /** JSDoc */ into a section. Unavailable while summary comments are hidden."><input type="checkbox" data-filter="collapseSummaryComments" /> Collapse summary comments</label>
    <label class="bbrd-check" title="Folders ending in Tests, such as Foo.Tests and Foo.UnitTests, and every file inside them"><input type="checkbox" data-filter="hideTestFolders" /> Test projects</label>
    <label class="bbrd-check" title="Solution files and every project type: .sln, .slnx, .csproj, .fsproj, .vbproj, .vcxproj"><input type="checkbox" data-filter="hideProjects" /> Solution and project files</label>
    <label class="bbrd-check" title="Lockfiles, minified code, and generated source such as Designer.cs"><input type="checkbox" data-filter="hideGenerated" /> Generated files</label>
    <label class="bbrd-check" title="A file whose only changes are comments"><input type="checkbox" data-filter="hideCommentFiles" /> Comment-only files</label>
    <label class="bbrd-ext">Extensions <input type="text" data-filter="hiddenExtensions" placeholder="svg, lock, min.js" spellcheck="false" /></label>
    <label class="bbrd-ext">Pattern <input type="text" data-filter="hidePattern" placeholder="\\.Tests|tmp/" spellcheck="false" /></label>
    <p class="bbrd-hint">Regular expression. Matches the path, a folder, or the file name.</p>
    <div class="bbrd-filters-foot" hidden>
      <span class="bbrd-hidden-count" aria-live="polite"></span>
      <button type="button" class="bbrd-hidden-toggle" hidden>Show</button>
    </div>`;
  panel.addEventListener('click', (event) => {
    event.stopPropagation();
    const toggle = event.target.closest('.bbrd-hidden-toggle');
    if (!toggle || !panel.contains(toggle)) return;
    event.preventDefault();
    revealed = !revealed;
    const last = lastApply;
    if (last) mountFileFilters(last.root, last.settings, last.onChange, last.commentOnly);
  });
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const input = event.target.closest('[data-filter]');
    if (!input) return;
    const key = input.dataset.filter;
    const value = key === 'hiddenExtensions' ? parseExtensions(input.value) : key === 'hidePattern' ? input.value : input.checked;
    if (key === 'hideSummaryComments') lockCollapse(panel, input.checked);
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
  const collapse = panel.querySelector('[data-filter="collapseSummaryComments"]');
  const tests = panel.querySelector('[data-filter="hideTestFolders"]');
  const projects = panel.querySelector('[data-filter="hideProjects"]');
  const generated = panel.querySelector('[data-filter="hideGenerated"]');
  const commentFiles = panel.querySelector('[data-filter="hideCommentFiles"]');
  if (markdown.checked !== settings.hideMarkdown) markdown.checked = settings.hideMarkdown;
  if (code.checked !== settings.hideCodeComments) code.checked = settings.hideCodeComments;
  if (summary.checked !== settings.hideSummaryComments) summary.checked = settings.hideSummaryComments;
  if (collapse) {
    const collapseOn = settings.hideSummaryComments ? false : !!settings.collapseSummaryComments;
    if (collapse.checked !== collapseOn) collapse.checked = collapseOn;
    lockCollapse(panel, settings.hideSummaryComments);
  }
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

/** Hide and collapse are alternatives. Hiding summary comments turns collapse off and leaves it unavailable. */
function lockCollapse(panel, hideSummary) {
  const collapse = panel.querySelector('[data-filter="collapseSummaryComments"]');
  if (!(collapse instanceof HTMLInputElement)) return;
  collapse.disabled = hideSummary;
  collapse.closest('label')?.classList.toggle('bbrd-check-disabled', hideSummary);
  if (hideSummary && collapse.checked) collapse.checked = false;
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
  const hiddenCount = CATEGORY_ORDER.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const summary = formatHideSummary(counts, lines);
  syncFlyoutSummary(root, summary);
  // Drop any leftover Show bars from older builds; Bitbucket re-renders the file tree and would duplicate them.
  for (const bar of documentOf(root).querySelectorAll('.bbrd-hidden-bar')) bar.remove();
  syncFileCounters(root, hiddenCount);
  return hiddenCount;
}

function syncFlyoutSummary(root, summary) {
  const panel = documentOf(root).querySelector('.bbrd-filters') ?? document.querySelector('.bbrd-filters');
  if (!panel) return;
  const count = panel.querySelector('.bbrd-hidden-count');
  if (count && count.textContent !== summary) count.textContent = summary;
  const foot = panel.querySelector('.bbrd-filters-foot');
  if (foot) foot.hidden = !summary;
  const toggle = panel.querySelector('.bbrd-hidden-toggle');
  if (!toggle) return;
  if (!summary) {
    toggle.hidden = true;
    return;
  }
  toggle.hidden = false;
  const text = revealed ? 'Hide' : 'Show';
  const name = revealed ? 'Hide hidden files' : 'Show hidden files';
  if (toggle.textContent !== text) toggle.textContent = text;
  toggle.setAttribute('aria-label', name);
}

function readStat(element) {
  const text = element?.textContent ?? '';
  return { added: sumPhrase(text, /([\d,]+)\s+lines?\s+added/gi), removed: sumPhrase(text, /([\d,]+)\s+lines?\s+removed/gi) };
}

function sumPhrase(text, pattern) {
  let total = 0;
  for (const match of text.matchAll(pattern)) total += Number(match[1].replaceAll(',', ''));
  return total;
}

function syncChip(item, category) {
  const host = item.querySelector(':scope > a[href*="#chg-"]') ?? item;
  let chip = host.querySelector(':scope > .bbrd-cat');
  if (!category) {
    chip?.remove();
    return;
  }
  const label = CATEGORY_LABEL[category];
  if (!chip) {
    chip = host.ownerDocument.createElement('span');
    chip.className = 'bbrd-cat bbrd-pill';
    chip.title = 'Hidden by Bitbucket Rich Diff';
  }
  chip.dataset.kind = category;
  if (chip.textContent !== label) chip.textContent = label;
  placeLeading(host, chip);
}

/**
 * While files are hidden, show actual (real minus hidden) beside the original Bitbucket total.
 * "0 of 14 files viewed" becomes "0 of 12 viewed · 14 files". "14 files changed" becomes
 * "12 of 14 files changed". The original string is stored the first time we see the node and
 * restored exactly when nothing is hidden. A later scan never treats rewritten text as the source.
 * @param {ParentNode} root
 * @param {number} hiddenCount
 */
function syncFileCounters(root, hiddenCount) {
  const doc = documentOf(root);
  const exclude = Boolean(hiddenCount) && !revealed;
  const viewedVisible = exclude ? countViewedVisible(root) : null;
  for (const node of counterLeaves(doc)) {
    rewriteCounter(node, VIEWED_COUNTER, ORIGINAL_VIEWED, exclude, hiddenCount, (viewed, total) => {
      const actual = Math.max(0, total - hiddenCount);
      const nextViewed = viewedVisible == null ? Math.min(viewed, actual) : Math.min(viewedVisible, actual);
      const word = total === 1 ? 'file' : 'files';
      return `${formatCount(nextViewed)} of ${formatCount(actual)} viewed · ${formatCount(total)} ${word}`;
    });
    rewriteCounter(node, CHANGED_COUNTER, ORIGINAL_CHANGED, exclude, hiddenCount, (_count, total, source) => {
      const actual = Math.max(0, total - hiddenCount);
      const word = /\bfile\b/i.test(source) && !/\bfiles\b/i.test(source) ? 'file' : 'files';
      return `${formatCount(actual)} of ${formatCount(total)} ${word} changed`;
    });
  }
}

function counterLeaves(doc) {
  if (!doc.body?.querySelectorAll) return [];
  const out = [];
  for (const el of doc.body.querySelectorAll('span, div, p, strong, em, label, a, li, h1, h2, h3, h4, button')) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest('.bbrd-filters, .bbrd-menu-host, .bbrd-hidden-bar, .bbrd-tabs, .bbrd-stats, [data-qa="bk-file__content"]')) continue;
    if ([...el.children].some((child) => child.nodeType === 1 && !(child instanceof HTMLElement && child.classList.contains('vh')))) continue;
    out.push(el);
  }
  return out;
}

/**
 * @param {HTMLElement} node
 * @param {RegExp} pattern
 * @param {string} datasetKey
 * @param {boolean} exclude
 * @param {number} hiddenCount
 * @param {(viewedOrCount: number, total: number, source: string) => string} format
 */
function rewriteCounter(node, pattern, datasetKey, exclude, hiddenCount, format) {
  const stored = node.dataset[datasetKey];
  const current = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  const source = stored || current;
  const match = source.match(pattern);
  if (!match) return;
  if (!stored) node.dataset[datasetKey] = source;
  if (!exclude || !hiddenCount) {
    const restored = groupCountText(node.dataset[datasetKey]);
    if (node.textContent !== restored) node.textContent = restored;
    return;
  }
  const first = Number(match[1].replaceAll(',', ''));
  const total = match[2] != null ? Number(match[2].replaceAll(',', '')) : first;
  const next = format(first, total, source);
  if (node.textContent !== next) node.textContent = next;
}

/** Checked Viewed boxes on files that are still showing. Null when the page has no such boxes, so the original numerator is kept. */
function countViewedVisible(root) {
  let total = 0;
  let sawBox = false;
  for (const article of findFileDiffs(root)) {
    const box = article.querySelector('.file-header input[type="checkbox"], [data-qa="bk-file__header"] input[type="checkbox"], label input[type="checkbox"]');
    if (!(box instanceof HTMLInputElement)) continue;
    sawBox = true;
    if (article.classList.contains('bbrd-file-hidden')) continue;
    if (box.checked) total += 1;
  }
  return sawBox ? total : null;
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
  const pills = [...button.querySelectorAll(':scope > .bbrd-hidden-pill')];
  if (!show) {
    for (const pill of pills) pill.remove();
    return;
  }
  for (const extra of pills.slice(1)) extra.remove();
  let pill = pills[0];
  if (!pill) {
    pill = button.ownerDocument.createElement('span');
    pill.className = 'bbrd-hidden-pill bbrd-pill';
    pill.dataset.kind = 'hidden';
    pill.textContent = 'Hidden';
    pill.title = 'Hidden by Bitbucket Rich Diff';
  }
  placeLeading(button, pill);
}

function placeLeading(host, pill) {
  const icon = [...host.children].find((child) => child !== pill && child instanceof HTMLElement && (child.getAttribute('role') === 'img' || child.tagName === 'svg' || child.getAttribute('aria-label') === 'Directory'));
  if (icon) {
    if (pill.parentElement === host && pill.nextElementSibling === icon) return;
    host.insertBefore(pill, icon);
    return;
  }
  if (host.firstElementChild === pill) return;
  host.insertBefore(pill, host.firstChild);
}
