import { isGeneratedFile, isMarkdownFile, isProjectFile } from './file-filter.js';
import { isTestFile } from './test-outline.js';

/** @typedef {'infrastructure' | 'business' | 'tests' | 'docs'} ReviewGroup */

/** Review order: scaffolding, then the code, then the proof, then the notes. */
export const REVIEW_GROUPS = [
  { id: 'infrastructure', label: 'Infrastructure', hint: 'Terraform, build, Docker, git, and config' },
  { id: 'business', label: 'Business', hint: 'Application code' },
  { id: 'tests', label: 'Tests', hint: 'Test projects and test files' },
  { id: 'docs', label: 'Documentation', hint: 'Markdown and the notes beside it' },
];

const INFRA_EXTENSIONS = ['.tf', '.tfvars', '.hcl', '.cake', '.yml', '.yaml', '.ini', '.toml', '.config', '.props', '.targets', '.dockerignore'];

const INFRA_NAMES = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'rakefile',
  'procfile',
  'jenkinsfile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  'nuget.config',
  'global.json',
  'codeowners',
]);

const INFRA_FOLDERS = /^(?:infra|terraform|deploy|\.github|k8s|kubernetes|charts|helm)$/i;

const DOC_NAME = /^(?:readme|license|licence|changelog|changes|contributing|authors|notice|code_of_conduct)(?:\.[a-z0-9]+)*$/i;

/**
 * One group per file. Tests win over a project file inside a test folder.
 * Documentation wins over a markdown file that would otherwise look like config.
 * Everything left is the application code.
 * @param {string | null | undefined} path
 * @returns {ReviewGroup}
 */
export function reviewGroup(path) {
  const text = String(path ?? '');
  if (isTestFile(text)) return 'tests';
  const segments = text.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  const lower = name.toLowerCase();
  if (isMarkdownFile(text) || DOC_NAME.test(name)) return 'docs';
  if (isInfrastructure(text, name, lower, segments.slice(0, -1))) return 'infrastructure';
  return 'business';
}

/**
 * @param {string} path
 * @param {string} name
 * @param {string} lower
 * @param {string[]} folders
 */
function isInfrastructure(path, name, lower, folders) {
  if (isProjectFile(path) || isGeneratedFile(path)) return true;
  if (INFRA_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  if (INFRA_NAMES.has(lower) || lower.startsWith('dockerfile') || lower.startsWith('.env') || lower.endsWith('.env')) return true;
  if (/^appsettings(?:\.|$)/i.test(lower)) return true;
  if (/^(?:tsconfig|jsconfig|package|composer)\b.*\.json$/i.test(lower) || lower === 'launchsettings.json') return true;
  return folders.some((folder) => INFRA_FOLDERS.test(folder));
}

/**
 * Bitbucket keeps reviewed files in localStorage under
 * `{workspace}/{repo}/{id}:files-reviewed-state`. The value is a map of path to true,
 * or to `{ reviewed: true }`, or a list of paths.
 * @param {string | null | undefined} raw
 * @returns {Set<string>}
 */
export function parseReviewedState(raw) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!raw) return out;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  const list = Array.isArray(data) ? data : reviewedList(data);
  if (list) {
    for (const item of list) {
      const path = typeof item === 'string' ? item : item?.path;
      const normal = normalizePath(path);
      if (normal) out.add(normal);
    }
    return out;
  }
  for (const [key, value] of Object.entries(data)) {
    const reviewed = value === true || value?.reviewed === true || value?.viewed === true;
    const normal = normalizePath(key);
    if (reviewed && normal) out.add(normal);
  }
  return out;
}

/**
 * @param {object} data
 * @returns {unknown[] | null}
 */
function reviewedList(data) {
  if (Array.isArray(data.files)) return data.files;
  if (Array.isArray(data.viewed)) return data.viewed;
  if (Array.isArray(data.paths)) return data.paths;
  return null;
}

/** @param {unknown} path */
export function normalizePath(path) {
  const text = String(path ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  return text;
}

/**
 * The next file to open. With a group selected, only that group is walked, in tree order.
 * With none selected, groups are walked infrastructure, business, tests, then documentation.
 * The search starts after the file already on screen and wraps around.
 * @param {Array<{ path: string, group: string }>} files
 * @param {Set<string>} reviewed
 * @param {string | null} group
 * @param {string | null} current
 * @param {string[]} [order] review order, left to right
 * @returns {{ path: string, group: string } | null}
 */
export function nextUnviewed(files, reviewed, group, current, order = REVIEW_GROUPS.map((item) => item.id)) {
  const rank = new Map(order.map((id, index) => [id, index]));
  const pool = files.filter((file) => !group || file.group === group);
  const ordered = group ? pool : [...pool].sort((a, b) => (rank.get(a.group) ?? order.length) - (rank.get(b.group) ?? order.length));
  if (!ordered.length) return null;
  const start = current ? ordered.findIndex((file) => file.path === current) : -1;
  for (let step = 1; step <= ordered.length; step += 1) {
    const file = ordered[(start + step + ordered.length) % ordered.length];
    if (!reviewed.has(file.path)) return file;
  }
  return null;
}

/**
 * The first group in review order that still has a file to view.
 * @param {Array<{ group: string, count: number, viewed: number }>} rows
 * @param {string[]} [order] review order, left to right
 * @returns {string | null}
 */
export function firstUnfinishedGroup(rows, order = REVIEW_GROUPS.map((item) => item.id)) {
  for (const id of order) {
    const row = rows.find((item) => item.group === id);
    if (row && row.count > 0 && row.viewed < row.count) return id;
  }
  return null;
}

/**
 * @param {{ workspace: string, repo: string, prId: number } | null | undefined} pr
 */
export function reviewedStorageKey(pr) {
  if (!pr) return null;
  return `${pr.workspace}/${pr.repo}/${pr.prId}:files-reviewed-state`;
}
