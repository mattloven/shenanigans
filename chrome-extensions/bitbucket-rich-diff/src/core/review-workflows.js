/**
 * Saved patterns a review group can use. The same pattern can be chosen by more than one group.
 * @typedef {object} ReviewFilter
 * @property {string} id
 * @property {string} name
 * @property {string} pattern  case-insensitive regular expression tested against the full path
 */

/**
 * @typedef {object} WorkflowGroup
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} filterId  id of a saved pattern, or '' when the group takes files nothing else claimed
 */

/**
 * @typedef {object} ReviewWorkflow
 * @property {string} id
 * @property {string} name
 * @property {WorkflowGroup[]} groups
 */

const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_WORKFLOWS = 8;
const MAX_GROUPS = 8;
const MAX_FILTERS = 24;
const MAX_NAME = 40;
const MAX_PATTERN = 800;
const PALETTE = ['#1558bc', '#206a83', '#5e4db2', '#7f5f01', '#ae2e24', '#216e4e', '#943d73', '#a54800'];
const SAMPLE_IDS = new Set(['tests', 'docs', 'infrastructure']);

/** A *Tests folder, a JS test/spec file, or a C# *Tests.cs file. */
export const TESTS_PATTERN = String.raw`(?:^|/)[^/]*Tests(?:/|$)|\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)$|(?:Tests?|Specs?)\.cs$`;

/** Markdown, plus readme, license, and changelog names. */
export const DOCS_PATTERN = String.raw`\.(?:md|markdown|mdown|mkd|mkdn)$|(?:^|/)(?:readme|license|licence|changelog|changes|contributing|authors|notice|code_of_conduct)(?:\.[^/]+)?$`;

const INFRA_BODY = [
  String.raw`\.(?:tf|tfvars|hcl|cake|ya?ml|ini|toml|config|props|targets|dockerignore|[a-z0-9]*proj|projitems|sln|slnx|slnf|env)$`,
  String.raw`(?:^|/)(?:dockerfile|makefile|gemfile|rakefile|procfile|jenkinsfile|nuget\.config|global\.json|codeowners)`,
  String.raw`(?:^|/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|packages\.lock\.json|composer\.lock|gemfile\.lock|poetry\.lock|cargo\.lock|go\.sum|podfile\.lock|package\.resolved)$`,
  String.raw`(?:^/)\.(?:gitignore|gitattributes|editorconfig|npmrc|nvmrc|env)`,
  String.raw`(?:^|/)appsettings(?:\.[^/]+)?\.json$`,
  String.raw`(?:^|/)launchsettings\.json$`,
  String.raw`(?:^|/)(?:tsconfig|jsconfig|package|composer)[^/]*\.json$`,
  String.raw`\.(?:designer\.cs|g\.cs|g\.i\.cs|generated\.cs|min\.js|min\.css)$`,
  String.raw`(?:^|/)(?:infra|terraform|deploy|\.github|k8s|kubernetes|charts|helm)(?:/|$)`,
].join('|');

/** Build, Docker, Terraform, config, project, lock, and generated files. A *Tests folder is left for the Tests pattern. */
export const INFRA_PATTERN = `^(?!.*(?:^|/)[^/]*Tests(?:/|$)).*(?:${INFRA_BODY})`;

/** The patterns shipped with .NET Workflow. Edit them; groups pick them by id. */
export function sampleFilters() {
  return [
    { id: 'tests', name: 'Tests', pattern: TESTS_PATTERN },
    { id: 'docs', name: 'Documentation', pattern: DOCS_PATTERN },
    { id: 'infrastructure', name: 'Infrastructure', pattern: INFRA_PATTERN },
  ];
}

/** The sample review path. Business has no pattern, so it takes whatever the others do not. */
export function dotnetWorkflow() {
  return {
    id: 'dotnet',
    name: '.NET Workflow',
    groups: [
      { id: 'infrastructure', name: 'Infrastructure', color: '#1558bc', filterId: 'infrastructure' },
      { id: 'business', name: 'Business', color: '#206a83', filterId: '' },
      { id: 'tests', name: 'Tests', color: '#5e4db2', filterId: 'tests' },
      { id: 'docs', name: 'Documentation', color: '#7f5f01', filterId: 'docs' },
    ],
  };
}

/**
 * @param {unknown} workflows
 * @param {unknown} activeId
 * @param {unknown} [filters]
 * @returns {{ reviewWorkflows: ReviewWorkflow[], activeReviewWorkflow: string, reviewFilters: ReviewFilter[] }}
 */
export function normalizeWorkflowState(workflows, activeId, filters) {
  const reviewFilters = normalizeFilters(filters);
  const reviewWorkflows = normalizeList(workflows, reviewFilters);
  const activeReviewWorkflow = reviewWorkflows.some((workflow) => workflow.id === activeId) ? String(activeId) : reviewWorkflows[0].id;
  return { reviewWorkflows, activeReviewWorkflow, reviewFilters };
}

/** @param {unknown} filters */
function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return sampleFilters();
  /** @type {ReviewFilter[]} */
  const list = [];
  const used = new Set();
  for (const item of filters.slice(0, MAX_FILTERS)) {
    const filter = normalizeFilter(item, used, list.length);
    if (filter) list.push(filter);
  }
  return list;
}

/**
 * @param {unknown} item
 * @param {Set<string>} used
 * @param {number} index
 * @returns {ReviewFilter | null}
 */
function normalizeFilter(item, used, index) {
  if (!item || typeof item !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (item);
  const id = freshId(cleanId(record.id, 'pattern'), used);
  used.add(id);
  return {
    id,
    name: cleanName(record.name, `Pattern ${index + 1}`),
    pattern: typeof record.pattern === 'string' ? record.pattern.slice(0, MAX_PATTERN) : '',
  };
}

/**
 * @param {unknown} workflows
 * @param {ReviewFilter[]} filters
 */
function normalizeList(workflows, filters) {
  const source = Array.isArray(workflows) ? workflows.slice(0, MAX_WORKFLOWS) : [];
  /** @type {ReviewWorkflow[]} */
  const list = [];
  const used = new Set();
  for (const item of source) {
    const workflow = normalizeWorkflow(item, used, filters);
    if (workflow) list.push(workflow);
  }
  if (!list.length) list.push(dotnetWorkflow());
  return list;
}

/**
 * @param {unknown} item
 * @param {Set<string>} used
 * @param {ReviewFilter[]} filters
 * @returns {ReviewWorkflow | null}
 */
function normalizeWorkflow(item, used, filters) {
  if (!item || typeof item !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (item);
  const id = freshId(cleanId(record.id, 'workflow'), used);
  used.add(id);
  return { id, name: cleanName(record.name, 'Workflow'), groups: normalizeGroups(record.groups, filters) };
}

/**
 * @param {unknown} groups
 * @param {ReviewFilter[]} filters
 */
function normalizeGroups(groups, filters) {
  const source = Array.isArray(groups) ? groups.slice(0, MAX_GROUPS) : [];
  /** @type {WorkflowGroup[]} */
  const list = [];
  const used = new Set();
  for (const item of source) {
    const group = normalizeGroup(item, used, list.length, filters);
    if (group) list.push(group);
  }
  if (!list.length) list.push({ id: 'all', name: 'All files', color: '#206a83', filterId: '' });
  return list;
}

/**
 * @param {unknown} item
 * @param {Set<string>} used
 * @param {number} index
 * @param {ReviewFilter[]} filters
 * @returns {WorkflowGroup | null}
 */
function normalizeGroup(item, used, index, filters) {
  if (!item || typeof item !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (item);
  const id = freshId(cleanId(record.id, 'group'), used);
  used.add(id);
  const color = typeof record.color === 'string' && COLOR.test(record.color) ? record.color.toLowerCase() : PALETTE[index % PALETTE.length];
  return { id, name: cleanName(record.name, 'Group'), color, filterId: resolveFilterId(record, filters) };
}

/**
 * Older groups stored a built-in kind. Those kinds are now the sample patterns.
 * @param {Record<string, unknown>} record
 * @param {ReviewFilter[]} filters
 */
function resolveFilterId(record, filters) {
  const known = new Set(filters.map((filter) => filter.id));
  if (typeof record.filterId === 'string') {
    if (!record.filterId) return '';
    return known.has(record.filterId) ? record.filterId : '';
  }
  const kind = typeof record.filter === 'string' ? record.filter : '';
  if (!kind || kind === 'rest' || kind === 'business') return '';
  if (SAMPLE_IDS.has(kind) && known.has(kind)) return kind;
  const pattern = typeof record.pattern === 'string' ? record.pattern.slice(0, MAX_PATTERN) : '';
  if (!pattern) return '';
  const existing = filters.find((filter) => filter.pattern === pattern);
  if (existing) return existing.id;
  if (filters.length >= MAX_FILTERS) return '';
  const id = freshId('pattern', known);
  known.add(id);
  filters.push({ id, name: cleanName(pattern, 'Pattern'), pattern });
  return id;
}

/**
 * @param {string} id
 * @param {Set<string>} used
 */
function freshId(id, used) {
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`.slice(0, 24);
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
function cleanId(value, fallback) {
  const text = String(value ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return /^[a-z]/.test(text) ? text : fallback;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
function cleanName(value, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return text || fallback;
}

/**
 * @param {{ reviewWorkflows?: ReviewWorkflow[], activeReviewWorkflow?: string, reviewFilters?: ReviewFilter[] } | null | undefined} settings
 */
export function workflowState(settings) {
  return normalizeWorkflowState(settings?.reviewWorkflows, settings?.activeReviewWorkflow, settings?.reviewFilters);
}

/**
 * @param {{ reviewWorkflows?: ReviewWorkflow[], activeReviewWorkflow?: string, reviewFilters?: ReviewFilter[] } | null | undefined} settings
 * @returns {ReviewWorkflow}
 */
export function activeWorkflow(settings) {
  const state = workflowState(settings);
  return state.reviewWorkflows.find((workflow) => workflow.id === state.activeReviewWorkflow) ?? state.reviewWorkflows[0];
}

/**
 * Patterns run from top to bottom. The first match wins. A group with no pattern
 * takes the files that nothing else claimed.
 * @param {string | null | undefined} path
 * @param {WorkflowGroup[] | null | undefined} groups
 * @param {ReviewFilter[] | null | undefined} [filters]
 */
export function assignGroup(path, groups, filters) {
  const state = normalizeWorkflowState(
    [{ id: 'assign', name: 'Assign', groups: groups?.length ? groups : dotnetWorkflow().groups }],
    'assign',
    filters,
  );
  const list = state.reviewWorkflows[0].groups;
  const library = new Map(state.reviewFilters.map((filter) => [filter.id, filter.pattern]));
  const text = String(path ?? '').replaceAll('\\', '/');
  for (const group of list) {
    const pattern = library.get(group.filterId) ?? '';
    if (pattern && patternHits(pattern, text)) return group.id;
  }
  return list.find((group) => !group.filterId)?.id ?? list[list.length - 1].id;
}

/**
 * @param {string} pattern
 * @param {string} path
 */
function patternHits(pattern, path) {
  const compiled = compileReviewPattern(pattern);
  if (!compiled || !path) return false;
  compiled.lastIndex = 0;
  return compiled.test(path);
}

/** @param {string} source */
export function compileReviewPattern(source) {
  const text = String(source ?? '').trim();
  if (!text || text.length > MAX_PATTERN) return null;
  try {
    return new RegExp(text, 'i');
  } catch {
    return null;
  }
}

/**
 * @param {WorkflowGroup[]} groups
 * @param {number} index
 * @param {number} delta
 */
export function moveGroup(groups, index, delta) {
  const next = index + delta;
  if (next < 0 || next >= groups.length) return groups;
  const copy = groups.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

/** @param {number} index */
export function paletteColor(index) {
  return PALETTE[index % PALETTE.length];
}
