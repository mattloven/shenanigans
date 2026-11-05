import { parseExtensions } from './file-filter.js';
import { dotnetWorkflow, normalizeWorkflowState, sampleFilters } from './review-workflows.js';

/**
 * @typedef {object} Settings
 * @property {{ enabled: boolean, defaultView: import('./file-types.js').ViewId }} markdown
 * @property {{ enabled: boolean, defaultView: import('./file-types.js').ViewId }} json
 * @property {boolean} showDeletions   show removed text/blocks in the rich diff
 * @property {boolean} onlyChanges     fold long runs of unchanged content
 * @property {PreviewLayout} previewLayout  which version(s) the Preview tab shows
 * @property {boolean} hideMarkdown         hide markdown files in the file list and the diff
 * @property {string[]} hiddenExtensions    extra extensions to hide, e.g. [".svg", ".lock"]
 * @property {boolean} hideCodeComments     hide line comments and block comments in JS and C# diffs
 * @property {boolean} hideSummaryComments  hide documentation comments (C# triple-slash and JSDoc)
 * @property {boolean} collapseSummaryComments  fold documentation comments into a section instead of leaving them inline
 * @property {boolean} hideTestFolders      hide folders whose names end in Tests, and everything inside them
 * @property {boolean} hideProjects         hide solution and MSBuild project files
 * @property {boolean} hideGenerated        hide lockfiles, minified files and generated source
 * @property {boolean} hideCommentFiles     hide files whose entire diff is comments
 * @property {string} hidePattern           regular expression matched against the path, each folder, and the file name
 * @property {boolean} hideReviewGroups    hide the Review path section under the summary
 * @property {import('./review-workflows.js').ReviewFilter[]} reviewFilters  named path patterns groups can reuse
 * @property {import('./review-workflows.js').ReviewWorkflow[]} reviewWorkflows  saved review paths, remembered for every pull request
 * @property {string} activeReviewWorkflow  which saved review path is shown
 */

/** @typedef {'old' | 'new' | 'split'} PreviewLayout */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  markdown: { enabled: true, defaultView: 'changes' },
  json: { enabled: true, defaultView: 'changes' },
  showDeletions: true,
  onlyChanges: false,
  previewLayout: 'split',
  hideMarkdown: false,
  hiddenExtensions: [],
  hideCodeComments: false,
  hideSummaryComments: false,
  collapseSummaryComments: false,
  hideTestFolders: false,
  hideProjects: false,
  hideGenerated: false,
  hideCommentFiles: false,
  hidePattern: '',
  hideReviewGroups: false,
  reviewFilters: sampleFilters(),
  reviewWorkflows: [dotnetWorkflow()],
  activeReviewWorkflow: 'dotnet',
};

export const PREVIEW_LAYOUTS = ['old', 'new', 'split'];

const VALID_VIEWS = new Set(['diff', 'changes', 'preview']);

/** Merges stored values over defaults, discarding anything malformed. */
export function normalizeSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const hideSummaryComments = typeof s.hideSummaryComments === 'boolean' ? s.hideSummaryComments : DEFAULT_SETTINGS.hideSummaryComments;
  const workflows = normalizeWorkflowState(s.reviewWorkflows, s.activeReviewWorkflow, s.reviewFilters);
  const type = (key) => ({
    enabled: typeof s[key]?.enabled === 'boolean' ? s[key].enabled : DEFAULT_SETTINGS[key].enabled,
    defaultView: VALID_VIEWS.has(s[key]?.defaultView) ? s[key].defaultView : DEFAULT_SETTINGS[key].defaultView,
  });
  return {
    markdown: type('markdown'),
    json: type('json'),
    showDeletions: typeof s.showDeletions === 'boolean' ? s.showDeletions : DEFAULT_SETTINGS.showDeletions,
    onlyChanges: typeof s.onlyChanges === 'boolean' ? s.onlyChanges : DEFAULT_SETTINGS.onlyChanges,
    previewLayout: PREVIEW_LAYOUTS.includes(s.previewLayout) ? s.previewLayout : DEFAULT_SETTINGS.previewLayout,
    hideMarkdown: typeof s.hideMarkdown === 'boolean' ? s.hideMarkdown : DEFAULT_SETTINGS.hideMarkdown,
    hiddenExtensions: parseExtensions(s.hiddenExtensions ?? []),
    hideCodeComments: typeof s.hideCodeComments === 'boolean' ? s.hideCodeComments : DEFAULT_SETTINGS.hideCodeComments,
    hideSummaryComments,
    collapseSummaryComments: hideSummaryComments ? false : typeof s.collapseSummaryComments === 'boolean' ? s.collapseSummaryComments : DEFAULT_SETTINGS.collapseSummaryComments,
    hideTestFolders: typeof s.hideTestFolders === 'boolean' ? s.hideTestFolders : DEFAULT_SETTINGS.hideTestFolders,
    hideProjects: typeof s.hideProjects === 'boolean' ? s.hideProjects : DEFAULT_SETTINGS.hideProjects,
    hideGenerated: typeof s.hideGenerated === 'boolean' ? s.hideGenerated : DEFAULT_SETTINGS.hideGenerated,
    hideCommentFiles: typeof s.hideCommentFiles === 'boolean' ? s.hideCommentFiles : DEFAULT_SETTINGS.hideCommentFiles,
    hidePattern: typeof s.hidePattern === 'string' ? s.hidePattern.slice(0, 200) : DEFAULT_SETTINGS.hidePattern,
    hideReviewGroups: typeof s.hideReviewGroups === 'boolean' ? s.hideReviewGroups : DEFAULT_SETTINGS.hideReviewGroups,
    reviewFilters: workflows.reviewFilters,
    reviewWorkflows: workflows.reviewWorkflows,
    activeReviewWorkflow: workflows.activeReviewWorkflow,
  };
}

const STORAGE_KEY = 'settings';

function storageArea() {
  return globalThis.chrome?.storage?.sync ?? null;
}

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  const area = storageArea();
  if (!area) return normalizeSettings(null);
  const data = await area.get(STORAGE_KEY);
  return normalizeSettings(data[STORAGE_KEY]);
}

export async function saveSettings(settings) {
  const area = storageArea();
  if (!area) return;
  await area.set({ [STORAGE_KEY]: normalizeSettings(settings) });
}

export function onSettingsChanged(callback) {
  const events = globalThis.chrome?.storage?.onChanged;
  if (!events) return;
  events.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[STORAGE_KEY]) callback(normalizeSettings(changes[STORAGE_KEY].newValue));
  });
}
