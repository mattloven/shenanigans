import { formatCount, pathFromFileLink } from '../core/file-filter.js';
import { firstUnfinishedGroup, nextUnviewed, normalizePath, parseReviewedState, reviewedStorageKey } from '../core/review-groups.js';
import { activeWorkflow, assignGroup, normalizeWorkflowState, workflowState } from '../core/review-workflows.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';
import { mountWorkflowEditor } from './workflow-editor.js';

const REVIEW_TITLE = 'Review path';
const REVIEW_HELP = 'Shows the selected workflow. Edit opens a dialog for the name, colour, order, and saved pattern of each group. Patterns can be reused and are remembered for every pull request. The .NET Workflow is the sample. Click a group to show only those files. The chosen card fills in and reads Showing. Continue opens the next group in the saved order when one is selected, or the first group that still has files to view when none is. On the last group it stays off. Next unviewed is a switch: while it is on, viewed files are hidden and the next one opens. A group turns green when every file in it is viewed. File hide rules pause while a group is selected. Comment settings still apply.';

/** @type {string | null} */
let activeGroup = null;
/** While on, files already marked viewed stay out of the list and the diff. */
let unviewedOnly = false;
/** @type {string | null} */
let shownWorkflow = null;
let editorOpen = false;
/** @type {WeakSet<Document>} */
const wiredDocs = new WeakSet();

/**
 * @typedef {object} ReviewFile
 * @property {string} path
 * @property {string} group
 * @property {Element} item
 * @property {number} added
 * @property {number} removed
 */

/** @typedef {(patch: { reviewWorkflows: import('../core/review-workflows.js').ReviewWorkflow[], reviewFilters: import('../core/review-workflows.js').ReviewFilter[], activeReviewWorkflow: string }) => void} WorkflowChange */

/** @type {{ root: ParentNode, pr: { workspace: string, repo: string, prId: number } | null, storage: Storage | null, settings: { hideReviewGroups?: boolean, reviewWorkflows?: import('../core/review-workflows.js').ReviewWorkflow[], activeReviewWorkflow?: string }, files: ReviewFile[], reviewed: Set<string>, onChange: WorkflowChange | null } | null} */
let lastMount = null;

/** The next pull request starts with every file showing. */
export function resetReviewGroup() {
  activeGroup = null;
  unviewedOnly = false;
  editorOpen = false;
  shownWorkflow = null;
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
 * @param {{ hideReviewGroups?: boolean, reviewWorkflows?: import('../core/review-workflows.js').ReviewWorkflow[], activeReviewWorkflow?: string }} [settings]
 * @param {WorkflowChange | null} [onChange]
 */
export function mountReviewGroups(root, pr = null, storage = null, settings = {}, onChange = null) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument ?? document;
  const store = storage ?? doc.defaultView?.localStorage ?? null;
  const panel = doc.querySelector('.bbrd-stats');
  if (!panel) return;
  ensureWorkflowOpen(doc);
  const state = workflowState(settings);
  const workflow = state.reviewWorkflows.find((item) => item.id === state.activeReviewWorkflow) ?? state.reviewWorkflows[0];
  const filters = state.reviewFilters;
  if (shownWorkflow && shownWorkflow !== workflow.id) activeGroup = null;
  shownWorkflow = workflow.id;
  const files = filesIn(root, workflow.groups, filters);
  const reviewed = reviewedPaths(root, pr, store);
  lastMount = { root, pr, storage: store, settings, files, reviewed, onChange };
  if (settings.hideReviewGroups) {
    activeGroup = null;
    unviewedOnly = false;
    editorOpen = false;
    panel.querySelector('.bbrd-review')?.remove();
    panel.querySelector(':scope > .bbrd-groups')?.remove();
    applyGroupFilter(root, files, workflow.groups, reviewed, filters);
    closeWorkflowDialog(doc);
    return;
  }
  const section = ensureSection(panel, settings, onChange);
  const bar = section.querySelector('.bbrd-groups');
  if (bar) wireGroupBar(bar);
  const ids = new Set(workflow.groups.map((group) => group.id));
  for (const button of bar ? [...bar.querySelectorAll('.bbrd-group')] : []) {
    if (!ids.has(button.dataset.group ?? '')) button.remove();
  }
  if (activeGroup && !files.some((file) => file.group === activeGroup)) activeGroup = null;
  /** @type {{ group: string, count: number, viewed: number }[]} */
  const summaries = [];
  for (const group of workflow.groups) {
    const rows = files.filter((file) => file.group === group.id);
    const viewed = rows.filter((file) => reviewed.has(file.path)).length;
    const added = rows.reduce((sum, file) => sum + file.added, 0);
    const removed = rows.reduce((sum, file) => sum + file.removed, 0);
    summaries.push({ group: group.id, count: rows.length, viewed });
    paintGroup(bar, group, filters, rows.length, viewed, added, removed);
    const painted = bar?.querySelector(`[data-group="${group.id}"]`);
    if (painted) bar?.append(painted);
  }
  paintActions(section, summaries, files, reviewed, workflow.groups.map((group) => group.id));
  applyGroupFilter(root, files, workflow.groups, reviewed, filters);
}

/** One listener on the bar keeps group toggles working after cards are rebuilt. */
function wireGroupBar(bar) {
  if (bar.dataset.bbrdGroupClicks === '1') return;
  bar.dataset.bbrdGroupClicks = '1';
  bar.addEventListener('click', (event) => {
    const node = event.target;
    const target = node && node.nodeType === 1 ? node : node?.parentElement;
    if (!target || typeof target.closest !== 'function') return;
    const button = target.closest('.bbrd-group');
    if (!button || button.tagName !== 'BUTTON' || !bar.contains(button)) return;
    if (button.disabled || !lastMount) return;
    const id = button.dataset.group;
    if (!id) return;
    activeGroup = activeGroup === id ? null : id;
    mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings, lastMount.onChange);
    bar.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
  });
}

/**
 * @param {HTMLElement | null} bar
 * @param {import('../core/review-workflows.js').WorkflowGroup} group
 * @param {import('../core/review-workflows.js').ReviewFilter[]} filters
 * @param {number} count
 * @param {number} viewed
 * @param {number} added
 * @param {number} removed
 */
function paintGroup(bar, group, filters, count, viewed, added, removed) {
  if (!bar) return;
  let button = bar.querySelector(`[data-group="${group.id}"]`);
  if (!button || button.tagName !== 'BUTTON') {
    button = bar.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'bbrd-group';
    button.dataset.group = group.id;
    button.innerHTML = '<span class="bbrd-group-name"></span><span class="bbrd-group-state">Showing</span><span class="bbrd-group-count"></span><span class="bbrd-group-lines"><span class="bbrd-add"></span> <span class="bbrd-del"></span></span><span class="bbrd-group-meter" aria-hidden="true"><span></span></span><span class="bbrd-group-viewed"></span>';
    bar.append(button);
  }
  const done = count > 0 && viewed === count;
  button.disabled = count === 0;
  const saved = filters.find((filter) => filter.id === group.filterId);
  button.title = saved ? `${saved.name}: ${saved.pattern}` : 'Remaining files';
  button.setAttribute('aria-pressed', activeGroup === group.id ? 'true' : 'false');
  button.dataset.done = done ? 'true' : 'false';
  button.style.setProperty('--bbrd-group-ink', done ? '#216e4e' : group.color);
  button.style.setProperty('--bbrd-group', done ? '#dcfff1' : `color-mix(in srgb, ${group.color} 16%, #fff)`);
  button.style.setProperty('--bbrd-group-selected', done ? '#dcfff1' : `color-mix(in srgb, ${group.color} 22%, #fff)`);
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
  if (name && name.textContent !== group.name) name.textContent = group.name;
  if (tally && tally.textContent !== countText) tally.textContent = countText;
  if (progress && progress.textContent !== viewedText) progress.textContent = viewedText;
  if (addedNode && addedNode.textContent !== addedText) addedNode.textContent = addedText;
  if (removedNode && removedNode.textContent !== removedText) removedNode.textContent = removedText;
  const width = count === 0 ? '0%' : `${Math.round((viewed / count) * 100)}%`;
  if (fill instanceof HTMLElement && fill.style.width !== width) fill.style.width = width;
  const showing = activeGroup === group.id ? 'Showing. ' : '';
  button.setAttribute('aria-label', `${showing}${group.name}, ${countText}, ${addedText} ${removedText}, ${viewedText}`);
}

/**
 * @param {HTMLElement} section
 * @param {{ group: string, count: number, viewed: number }[]} summaries
 * @param {ReviewFile[]} files
 * @param {Set<string>} reviewed
 * @param {string[]} order
 */
function paintActions(section, summaries, files, reviewed, order) {
  const head = section.querySelector('.bbrd-review-head');
  if (!head) return;
  let actions = head.querySelector('.bbrd-review-actions');
  if (!actions) {
    actions = section.ownerDocument.createElement('div');
    actions.className = 'bbrd-review-actions';
    actions.innerHTML = '<button type="button" class="bbrd-review-continue">Continue</button><label class="bbrd-switch"><input type="checkbox" class="bbrd-review-next" /><span>Next unviewed</span></label>';
    actions.querySelector('.bbrd-review-continue')?.addEventListener('click', () => {
      if (!lastMount) return;
      const groups = activeWorkflow(lastMount.settings).groups;
      const orderIds = groups.map((group) => group.id);
      const next = continueTarget(
        activeGroup,
        summariesFor(lastMount.files, lastMount.reviewed, groups),
        orderIds,
      );
      if (!next) return;
      activeGroup = next;
      mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings, lastMount.onChange);
      actions.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
    });
    actions.querySelector('.bbrd-review-next')?.addEventListener('change', () => {
      if (!lastMount) return;
      const box = actions.querySelector('.bbrd-review-next');
      unviewedOnly = box instanceof HTMLInputElement && box.checked;
      const groups = activeWorkflow(lastMount.settings).groups;
      const orderIds = groups.map((group) => group.id);
      mountReviewGroups(lastMount.root, lastMount.pr, lastMount.storage, lastMount.settings, lastMount.onChange);
      actions.ownerDocument.dispatchEvent(new CustomEvent('bbrd-review-group'));
      if (!unviewedOnly) return;
      const file = nextUnviewed(lastMount.files, lastMount.reviewed, activeGroup, currentPath(lastMount.root), orderIds);
      const link = file?.item.querySelector('a[href*="#chg-"]');
      if (!(link instanceof HTMLElement)) return;
      link.scrollIntoView?.({ block: 'nearest' });
      link.click();
    });
    head.append(actions);
  }
  const groups = activeWorkflow(lastMount?.settings).groups;
  const continueId = continueTarget(activeGroup, summaries, order);
  const continueButton = actions.querySelector('.bbrd-review-continue');
  if (continueButton instanceof HTMLButtonElement) {
    const nextName = continueId ? groups.find((group) => group.id === continueId)?.name ?? continueId : '';
    const finished = !firstUnfinishedGroup(summaries, order);
    const continueText = continueId ? `Continue to ${nextName}` : finished && !activeGroup ? 'Done' : 'Continue';
    continueButton.disabled = !continueId;
    if (continueButton.textContent !== continueText) continueButton.textContent = continueText;
    continueButton.title = continueId
      ? `Show ${nextName}`
      : finished && !activeGroup
        ? 'Every file is marked viewed'
        : 'This is the last group';
  }
  const upcoming = nextUnviewed(files, reviewed, activeGroup, currentPath(section.ownerDocument), order);
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
 * Next group for Continue: the following card when one is selected, else the first unfinished.
 * @param {string | null} selected
 * @param {{ group: string, count: number, viewed: number }[]} summaries
 * @param {string[]} order
 */
function continueTarget(selected, summaries, order) {
  if (selected) {
    const index = order.indexOf(selected);
    if (index < 0 || index >= order.length - 1) return null;
    return order[index + 1];
  }
  return firstUnfinishedGroup(summaries, order);
}

/**
 * @param {ReviewFile[]} files
 * @param {Set<string>} reviewed
 */
/**
 * @param {ReviewFile[]} files
 * @param {Set<string>} revie