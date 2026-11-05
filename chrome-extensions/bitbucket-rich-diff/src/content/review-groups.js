import { formatCount, pathFromFileLink } from '../core/file-filter.js';
import { firstUnfinishedGroup, nextUnviewed, normalizePath, parseReviewedState, REVIEW_GROUPS, reviewGroup, reviewedStorageKey } from '../core/review-groups.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const REVIEW_TITLE = 'Review path';
const REVIEW_HELP = 'Splits this pull request into infrastructure, business, tests, and documentation. Click a group to show only those files. The chosen card fills in and reads Showing. Continue opens the first group that is not finished. Next unviewed is a switch: while it is on, viewed files are hidden and the next one opens. A group turns green when every file in it is viewed. File hide rules pause while a group is selected. Comment settings still apply.';

/** @type {import('../core/review-groups.js').ReviewGroup | null} */
let activeGroup = null;
/** While on, files already marked viewed stay out of the list and the diff. */
let unviewedOnly = false;

/**
 * @typedef {object} ReviewFile
 * @property {string} path
 * @property {import('../core/review-groups.js').ReviewGroup} group
 * @property {Element} item
 * @property {number} added
 * @property {number} removed
 */

/** @type {{ root: ParentNode, pr: { workspace: string, repo: string, prId: number } | null, storage: Storage | null, settings: { hideReviewGroups?: boolean }, files: ReviewFile[], reviewed: Set<string> } | null} */
let lastMount = null;

/** The next pull request starts with every file showing. */
export function resetReviewGroup() {
  activeGroup = null;
  unviewedOnly = false;
}

/** The group currently filtering the file list, if one is selected. */
export function activeReviewGroup() {
  return activeGroup;
}

/**
 * Draws the four review groups under the summary tiles and, when one is selected,
 * leaves only that group's files in the list and the diff.
 * @param {ParentNode} root
 * @param {{ workspace: string, repo: string, prId: number } | null} [pr]
 * @param {Storage | null} [storage]
 * @param {{ hideReviewGroups?: boolean }} [settings]
 */
export function mountReviewGroups(root, pr = null, storage = null, settings = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  const store = storage ?? doc.defaultView?.localStorage ?? null;
  const panel = doc.querySelector('.bbrd-stats');
  if (!panel) return;
  const files = filesIn(root);
  const reviewed = reviewedPaths(root, pr, store);
  lastMount = { root, pr, storage: store, settings, files, reviewed };
  if (settings.hideReviewGroups) {
    activeGroup = null;
    unviewedOnly = false;
    panel.querySelector('.bbrd-review')?.remove();
    panel.querySelector(':scope > .bbrd-groups')?.remove();
    applyGroupFilter(root, files, reviewed);
    return;
  }
  const section = ensureSection(panel);
  const bar = section.querySelector('.bbrd-groups');
  /** @type {{ group: import('../core/review-groups.js').ReviewGroup, count: number, viewed: number }[]} */
  const summaries = [];
  for (const group of REVIEW_GROUPS) {
    const rows = files.filter((file) => file.group === group.id);
    const viewed = rows.filter((file) => reviewed.has(file.path)).length;
    const added = rows.reduce((sum, file) => sum + file.added, 0);
    const removed = rows.reduce((sum, file) => sum + file.removed, 0);
    summaries.push({ group: group.id, count: rows.length, viewed });
    paintGroup(bar, group, rows.length, viewed, added, removed);
  }
  paintActions(section, summaries, files, reviewed);
  if (activeGroup && !files.some((file) => file.group === activeGroup)) activeGroup = null;
  applyGroupFilter(root, files, reviewed);
}

/**
 * @param {HTMLElement | null} bar
 * @param {{ id: import('../core/review-groups.js').ReviewGroup, label: string, hint: string }} group
 * @param {number} count
 * @param {number} viewed
 * @param {number} added
 * @param {number} removed
 */
function paintGroup(bar, group, count, viewed, added, removed) {
  if (!bar) return;
  let button = bar.querySelector(`[data-group="${group.id}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    button = bar.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'bbrd-group';
    button.dataset.group = group.id;
    button.innerHTML = '<span class="bbrd-group-name"></span><span class="bbrd-group-state">Showing</span><span class="bbrd-group-count"></span><span class="bbrd-group-lines"><span class="bbrd-add"></span> <span class="bbrd-del"></span></span><span class="bbrd-group-meter" aria-hidden="true"><span></span></span><span class="bbrd-group-viewed"></span>';
    button.addEventListener('click', () => {
      if (button.disabled || !lastMount) return;
      activeGroup = activeGroup === group.id ? null : group.id;
      mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings);
      button.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
    });
    bar.append(button);
  }
  const done = count > 0 && viewed === count;
  button.disabled = count === 0;
  button.title = group.hint;
  button.setAttribute('aria-pressed', activeGroup === group.id ? 'true' : 'false');
  button.dataset.done = done ? 'true' : 'false';
  const name = button.querySelector('.bbrd-group-name');
  const tally = button.querySelector('.bbrd-group-count');
  const progress = button.querySelector('.bbrd-group-viewed');
  const fill = button.querySelector('.bbrd-group-meter span');
  const addedNode = button.querySelector('.bbrd-add');
  const removedNode = button.querySelector('.bbrd-del');
  const countText = `${formatCount(count)} ${count === 1 ? 'file' : 'files'}`;
  const viewedText = done ? 'Done' : `${formatCount(viewed)} viewed`;
  const addedText = `+${formatCount(added)}`;
  const removedText = `−${formatCount(removed)}`;
  if (name && name.textContent !== group.label) name.textContent = group.label;
  if (tally && tally.textContent !== countText) tally.textContent = countText;
  if (progress && progress.textContent !== viewedText) progress.textContent = viewedText;
  if (addedNode && addedNode.textContent !== addedText) addedNode.textContent = addedText;
  if (removedNode && removedNode.textContent !== removedText) removedNode.textContent = removedText;
  const width = count === 0 ? '0%' : `${Math.round((viewed / count) * 100)}%`;
  if (fill instanceof HTMLElement && fill.style.width !== width) fill.style.width = width;
  const showing = activeGroup === group.id ? 'Showing. ' : '';
  button.setAttribute('aria-label', `${showing}${group.label}, ${countText}, ${addedText} ${removedText}, ${viewedText}`);
}

/**
 * @param {HTMLElement} section
 * @param {{ group: import('../core/review-groups.js').ReviewGroup, count: number, viewed: number }[]} summaries
 * @param {ReviewFile[]} files
 * @param {Set<string>} reviewed
 */
function paintActions(section, summaries, files, reviewed) {
  const head = section.querySelector('.bbrd-review-head');
  if (!head) return;
  let actions = head.querySelector('.bbrd-review-actions');
  if (!actions) {
    actions = section.ownerDocument.createElement('div');
    actions.className = 'bbrd-review-actions';
    actions.innerHTML = '<button type="button" class="bbrd-review-continue">Continue</button><label class="bbrd-switch"><input type="checkbox" class="bbrd-review-next" /><span>Next unviewed</span></label>';
    actions.querySelector('.bbrd-review-continue')?.addEventListener('click', () => {
      if (!lastMount) return;
      const next = firstUnfinishedGroup(summariesFor(lastMount.files, lastMount.reviewed));
      if (!next) return;
      activeGroup = next;
      mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings);
      actions.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
    });
    actions.querySelector('.bbrd-review-next')?.addEventListener('change', () => {
      if (!lastMount) return;
      const box = actions.querySelector('.bbrd-review-next');
      unviewedOnly = box instanceof HTMLInputElement && box.checked;
      mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings);
      actions.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
      if (!unviewedOnly) return;
      const file = nextUnviewed(lastMount.files, lastMount.reviewed, activeGroup, currentPath(lastMount.root));
      const link = file?.item.querySelector('a[href*="#chg-"]');
      if (!(link instanceof HTMLElement)) return;
      link.scrollIntoView?.({ block: 'nearest' });
      link.click();
    });
    head.append(actions);
  }
  const unfinished = firstUnfinishedGroup(summaries);
  const continueButton = actions.querySelector('.bbrd-review-continue');
  if (continueButton instanceof HTMLButtonElement) {
    continueButton.disabled = !unfinished;
    const continueText = unfinished ? 'Continue' : 'Done';
    if (continueButton.textContent !== continueText) continueButton.textContent = continueText;
    continueButton.title = unfinished ? 'Show the first group that still has files to view' : 'Every file is marked viewed';
  }
  const upcoming = nextUnviewed(files, reviewed, activeGroup, currentPath(section.ownerDocument));
  if (!upcoming) unviewedOnly = false;
  const nextSwitch = actions.querySelector('.bbrd-review-next');
  if (nextSwitch instanceof HTMLInputElement) {
    nextSwitch.checked = unviewedOnly;
    nextSwitch.disabled = !upcoming;
    nextSwitch.title = upcoming ? `Open ${upcoming.path}` : 'Every file in this view is marked viewed';
    nextSwitch.closest('.bbrd-switch')?.classList.toggle('is-on', unviewedOnly);
    nextSwitch.closest('.bbrd-switch')?.classList.toggle('is-disabled', !upcoming);
  }
}

/**
 * @param {ReviewFile[]} files
 * @param {Set<string>} reviewed
 */
function summariesFor(files, reviewed) {
  return REVIEW_GROUPS.map((group) => {
    const rows = files.filter((file) => file.group === group.id);
    return { group: group.id, count: rows.length, viewed: rows.filter((file) => reviewed.has(file.path)).length };
  });
}

/** @param {ParentNode} root */
function currentPath(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const hash = doc?.defaultView?.location?.hash ?? '';
  const fromHash = normalizePath(pathFromFileLink(hash));
  if (fromHash) return fromHash;
  for (const article of findFileDiffs(root)) {
    if (article.classList.contains('bbrd-group-hidden')) continue;
    const path = normalizePath(getFilePath(article));
    if (path) return path;
  }
  return null;
}

/** @param {HTMLElement} panel */
function ensureSection(panel) {
  panel.querySelector(':scope > .bbrd-groups')?.remove();
  let section = panel.querySelector('.bbrd-review');
  if (!section) {
    section = panel.ownerDocument.createElement('section');
    section.className = 'bbrd-review';
    section.innerHTML = `<div class="bbrd-review-head"><h3></h3><button type="button" class="bbrd-info" aria-label="About ${REVIEW_TITLE}">i</button></div><div class="bbrd-groups" role="group" aria-label="${REVIEW_TITLE}"></div>`;
    const info = section.querySelector('.bbrd-info');
    info?.addEventListener('click', (event) => event.preventDefault());
    panel.append(section);
  }
  const heading = section.querySelector('h3');
  if (heading && heading.textContent !== REVIEW_TITLE) heading.textContent = REVIEW_TITLE;
  const info = section.querySelector('.bbrd-info');
  if (info && info.getAttribute('title') !== REVIEW_HELP) info.setAttribute('title', REVIEW_HELP);
  return section;
}

/** @param {Element} item */
function readLines(item) {
  let added = 0;
  let removed = 0;
  const doc = item.ownerDocument;
  if (!doc?.createTreeWalker) {
    return { added: sumPhrase(item.textContent || '', 'added'), removed: sumPhrase(item.textContent || '', 'removed') };
  }
  const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent || '';
    added += sumPhrase(text, 'added');
    removed += sumPhrase(text, 'removed');
    node = walker.nextNode();
  }
  return { added, removed };
}

/**
 * Counts a row's own "N lines added" / "N lines removed" wording.
 * The +/− badge is a separate text node, so reading the row's full text glues them
 * ("+31" and "31 lines added" become "+3131 lines added"). Each text node is counted on its own.
 * @param {string} text
 * @param {'added' | 'removed'} kind
 */
function sumPhrase(text, kind) {
  const number = String.raw`\d{1,3}(?:,\d{3})*|\d+`;
  const plain = new RegExp(`(${number})\\s+lines?\\s+${kind}`, 'gi');
  let total = 0;
  for (const match of text.matchAll(plain)) total += Number(match[1].replaceAll(',', ''));
  return total;
}

/** @param {ParentNode} root */
function filesIn(root) {
  /** @type {{ path: string, group: import('../core/review-groups.js').ReviewGroup, item: Element }[]} */
  const files = [];
  const seen = new Set();
  if (!root.querySelectorAll) return files;
  for (const link of root.querySelectorAll('a[href*="#chg-"]')) {
    const path = normalizePath(pathFromFileLink(link.getAttribute('href')));
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const item = link.closest('li') ?? link;
    const lines = readLines(item);
    files.push({ path, group: reviewGroup(path), item, added: lines.added, removed: lines.removed });
  }
  return files;
}

/**
 * A checked Viewed box on an open file wins over the stored map.
 * @param {ParentNode} root
 * @param {{ workspace: string, repo: string, prId: number } | null} pr
 * @param {Storage | null} storage
 */
function reviewedPaths(root, pr, storage) {
  const key = reviewedStorageKey(pr);
  let stored = new Set();
  if (key && storage) {
    try {
      stored = parseReviewedState(storage.getItem(key));
    } catch {
      stored = new Set();
    }
  }
  for (const article of findFileDiffs(root)) {
    const path = normalizePath(getFilePath(article));
    const box = article.querySelector('[data-qa="bk-file__header"] input[type="checkbox"], .file-header input[type="checkbox"]');
    if (!path || !(box instanceof HTMLInputElement)) continue;
    if (box.checked) stored.add(path);
    else stored.delete(path);
  }
  return stored;
}

/**
 * @param {ParentNode} root
 * @param {{ path: string, group: import('../core/review-groups.js').ReviewGroup, item: Element }[]} files
 * @param {Set<string>} reviewed
 */
function applyGroupFilter(root, files, reviewed) {
  const active = activeGroup;
  const hidePath = (path, group) => (Boolean(active) && group !== active) || (unviewedOnly && reviewed.has(path));
  for (const file of files) {
    file.item.classList.toggle('bbrd-group-hidden', hidePath(file.path, file.group));
  }
  if (root.querySelectorAll) {
    for (const article of findFileDiffs(root)) {
      const path = normalizePath(getFilePath(article));
      const hide = !!path && hidePath(path, reviewGroup(path));
      article.classList.toggle('bbrd-group-hidden', hide);
    }
    for (const folder of root.querySelectorAll('#file-tree li')) {
      if (folder.querySelector(':scope > a[href*="#chg-"]')) continue;
      const links = [...folder.querySelectorAll('a[href*="#chg-"]')];
      if (!links.length) continue;
      const allGone = (Boolean(active) || unviewedOnly) && links.every((link) => {
        const row = link.closest('li');
        return !!row && (row.classList.contains('bbrd-group-hidden') || row.classList.contains('bbrd-file-hidden'));
      });
      folder.classList.toggle('bbrd-group-hidden', allGone);
    }
  }
}
