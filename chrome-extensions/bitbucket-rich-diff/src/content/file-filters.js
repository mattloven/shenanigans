import { CATEGORY_LABEL, CATEGORY_ORDER, compileHidePattern, fileCategory, formatCount, formatHideSummary, groupCountText, isHiddenFolder, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';
import { activeReviewGroup } from './review-groups.js';

const MENU_LABEL = 'Hide files and comments';
/** File rules a review group replaces. Comment checkboxes are not in this list. */
const FILE_FILTERS = ['hideMarkdown', 'hideTestFolders', 'hideProjects', 'hideGenerated', 'hideCommentFiles', 'hiddenExtensions', 'hidePattern'];
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
  shapeReviewOption(panel);
  shapeWorkflowSlot(panel);
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
    <div class="bbrd-workflow-slot">
      <div class="bbrd-filters-section">Workflow</div>
      <label class="bbrd-ext">Show <select data-workflow aria-label="Review workflow"></select></label>
      <button type="button" class="bbrd-workflow-open">Edit groups</button>
      <p class="bbrd-hint">Name, colour, filter, and order. Saved for every pull request. .NET Workflow is the sample.</p>
    </div>
    <label class="bbrd-check" title="Hides the Review path section under the summary."><input type="checkbox" data-filter="hideReviewGroups" /> Review path</label>
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
    const opener = event.target.closest('.bbrd-workflow-open');
    if (opener && panel.contains(opener)) {
      event.preventDefault();
      closeMenu(panel.ownerDocument);
      panel.ownerDocument.dispatchEvent(new CustomEvent('bbrd-edit-workflow'));
      return;
    }
    const toggle = event.target.closest('.bbrd-hidden-toggle');
    if (!toggle || !panel.contains(toggle)) return;
    event.preventDefault();
    revealed = !revealed;
    const last = lastApply;
    if (last) mountFileFilters(last.root, last.settings, last.onChange, last.commentOnly);
  });
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  panel.addEventListener('change', (event) => {
    const workflow = event.target.closest('[data-workflow]');
    if (workflow instanceof HTMLSelectElement && panel.contains(workflow)) {
      changeHandlers.get(panel)?.('activeReviewWorkflow', workflow.value);
      return;
    }
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

/** Adds the workflow picker on a menu built before it existed. */
function shapeWorkflowSlot(panel) {
  if (panel.querySelector('[data-workflow]')) return;
  const head = panel.querySelector('.bbrd-filters-head');
  if (!head) return;
  const slot = panel.ownerDocument.createElement('div');
  slot.className = 'bbrd-workflow-slot';
  slot.innerHTML = `
    <div class="bbrd-filters-section">Workflow</div>
    <label class="bbrd-ext">Show <select data-workflow aria-label="Review workflow"></select></label>
    <button type="button" class="bbrd-workflow-open">Edit groups</button>
    <p class="bbrd-hint">Name, colour, filter, and order. Saved for every pull request. .NET Workflow is the sample.</p>`;
  head.insertAdjacentElement('afterend', slot);
}

/** Adds the Review path checkbox on a menu built before it existed. */
function shapeReviewOption(panel) {
  if (panel.querySelector('[data-filter="hideReviewGroups"]')) return;
  const head = panel.querySelector('.bbrd-filters-head');
  if (!head) return;
  const label = panel.ownerDocument.createElement('label');
  label.className = 'bbrd-check';
  label.title = 'Hides the Review path section under the summary.';
  label.innerHTML = '<input type="checkbox" data-filter="hideReviewGroups" /> Review path';
  head.insertAdjacentElement('afterend', label);
}

function syncPanel(panel, settings) {
  const review = panel.querySelector('[data-filter="hideReviewGroups"]');
  const markdown = panel.querySelector('[data-filter="hideMarkdown"]');
  const code = panel.querySelector('[data-filter="hideCodeComments"]');
  const summary = panel.querySelector('[data-filter="hideSummaryComments"]');
  const collapse = panel.querySelector('[data-filter="collapseSummaryComments"]');
  const tests = panel.querySelector('[data-filter="hideTestFolders"]');
  const projects = panel.querySelector('[data-filter="hideProjects"]');
  const generated = panel.querySelector('[data-filter="hideGenerated"]');
  const commentFiles = panel.querySelector('[data-filter="hideCommentFiles"]');
  if (review && review.checked !== !!settings.hideReviewGroups) review.checked = !!settings.hideReviewGroups;
  if (markdown.checked !== settings.hideMarkdown) markdown.checked = settings.hideMarkdown;
  if (code.checked !== settings.hideCodeComments) code.checked = settings.hideCodeComments;
  if (summary.checked !== settings.hideSummaryComments) summary.checked = settings.hideSummaryComments;
  if (collapse) {
    const collapseOn = settings.hideSummaryComments ? false : !!settings.collapseSummaryComments;
    if (collapse.checked !== collapseOn) collapse.checked = collapseOn;
    lockCollapse(pan