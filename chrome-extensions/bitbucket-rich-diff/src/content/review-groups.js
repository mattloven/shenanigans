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
 * @param {{ hideReviewGroups?: boolean, reviewWorkflows?: import('../core/review-workflows.js')