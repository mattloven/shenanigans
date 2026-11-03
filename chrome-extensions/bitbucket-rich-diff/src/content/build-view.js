import { alignMarkdownBlocks, diffMarkdown } from '../core/markdown-diff.js';
import { renderMarkdown } from '../core/markdown.js';
import { collectChanges, diffJson, parseJsonLoose, summarize } from '../core/json-diff.js';
import { renderJsonDiff, renderJsonSummary, renderJsonTree } from '../core/json-render.js';
import { escapeHtml } from '../core/escape.js';

/**
 * @typedef {object} BuiltView
 * @property {string} html                 unsanitised body HTML
 * @property {{ added: number, removed: number, modified: number } | null} stats
 * @property {string[]} notes              short informational messages for the toolbar
 * @property {boolean} navigable           whether prev/next change navigation applies
 * @property {boolean} tree                whether expand/collapse-all applies
 * @property {boolean} [compare]           whether the old/new/side-by-side layout switch applies
 */

/**
 * @param {import('../core/file-types.js').RichFileType} type
 * @param {'changes' | 'preview'} view
 * @param {{ entry: { status: string }, oldText: string | null, newText: string | null, resolveOldUrl?: Function, resolveNewUrl?: Function }} data
 * @returns {BuiltView}
 */
export function buildView(type, view, data) {
  switch (type) {
    case 'markdown':
      return buildMarkdownView(view, data);
    case 'json':
      return buildJsonView(view, data);
    default: {
      const unreachable = /** @type {never} */ (type);
      throw new Error(`Unsupported file type ${unreachable}`);
    }
  }
}

function statusNotes(data) {
  if (data.oldText === null) return ['New file'];
  if (data.newText === null) return ['Deleted file — showing the previous version'];
  if (data.entry.status === 'renamed') return ['Renamed'];
  return [];
}

/**
 * Plain (no change markup) rendering of both versions in two panes. The UI shows the old pane,
 * the new pane, or both side by side.
 */
function buildPreview(data, renderSide, { tree }) {
  const pane = (which) => {
    const text = which === 'old' ? data.oldText : data.newText;
    const side = which === 'old' ? data.entry.old : data.entry.new;
    const label = which === 'old' ? 'Before' : 'After';
    const commit = side?.commit ? `<code>${escapeHtml(side.commit.slice(0, 12))}</code>` : '';
    const renamed = which === 'old' && data.entry.old && data.entry.new && data.entry.old.path !== data.entry.new.path ? ` <span class="cmp-path">${escapeHtml(data.entry.old.path)}</span>` : '';
    let body;
    if (text === null) {
      body = `<div class="cmp-empty">${which === 'old' ? 'This file did not exist before this pull request.' : 'This file is deleted in this pull request.'}</div>`;
    } else {
      try {
        body = renderSide(text, which);
      } catch (error) {
        body = errorHtml(error.message);
      }
    }
    return `<section class="cmp-pane cmp-pane--${which}" aria-label="${label}"><header class="cmp-head">${label} ${commit}${renamed}</header><div class="cmp-body">${body}</div></section>`;
  };
  return {
    html: `<div class="cmp">${pane('old')}${pane('new')}</div>`,
    stats: null,
    notes: [],
    navigable: false,
    tree,
    compare: true,
  };
}

/** Side-by-side markdown preview laid out as a grid so matching sections share a row. */
function buildAlignedMarkdownPreview(data) {
  const head = (which) => {
    const side = data.entry[which];
    const label = which === 'old' ? 'Before' : 'After';
    const commit = side?.commit ? ` <code>${escapeHtml(side.commit.slice(0, 12))}</code>` : '';
    const renamed = which === 'old' && data.entry.old && data.entry.new && data.entry.old.path !== data.entry.new.path ? ` <span class="cmp-path">${escapeHtml(data.entry.old.path)}</span>` : '';
    return `<header class="cmp-head cmp-cell--${which}">${label}${commit}${renamed}</header>`;
  };
  const rows = alignMarkdownBlocks(data.oldText, data.newText, { resolveOldUrl: data.resolveOldUrl, resolveNewUrl: data.resolveNewUrl })
    .map((row) => `<div class="cmp-cell cmp-cell--old">${row.old ?? ''}</div><div class="cmp-cell cmp-cell--new">${row.new ?? ''}</div>`)
    .join('');
  return {
    html: `<div class="cmp cmp--grid markdown-body">${head('old')}${head('new')}${rows}</div>`,
    stats: null,
    notes: [],
    navigable: false,
    tree: false,
    compare: true,
  };
}

function buildMarkdownView(view, data) {
  if (view === 'preview' && data.oldText !== null && data.newText !== null) return buildAlignedMarkdownPreview(data);
  if (view === 'preview') {
    return buildPreview(
      data,
      (text, which) => `<div class="markdown-body">${renderMarkdown(text, { resolveUrl: which === 'old' ? data.resolveOldUrl : data.resolveNewUrl })}</div>`,
      { tree: false },
    );
  }
  const { html, stats } = diffMarkdown(data.oldText, data.newText, { resolveOldUrl: data.resolveOldUrl, resolveNewUrl: data.resolveNewUrl });
  const notes = statusNotes(data);
  if (stats.added + stats.removed + stats.modified === 0) notes.push('No content changes (whitespace or formatting only)');
  return { html: `<div class="markdown-body bbrd-track">${html}</div>`, stats, notes, navigable: true, tree: false };
}

function parseSide(text, label) {
  if (text === null) return { value: undefined, loose: false };
  const res = parseJsonLoose(text);
  if (!res.ok) throw new JsonViewError(`The ${label} version is not valid JSON: ${res.error}`);
  return res;
}

export class JsonViewError extends Error {}

function buildJsonView(view, data) {
  if (view === 'preview') {
    return buildPreview(data, (text, which) => renderJsonTree(parseSide(text, which).value, { openDepth: 2 }), { tree: true });
  }
  const before = parseSide(data.oldText, 'old');
  const after = parseSide(data.newText, 'new');
  const root = diffJson(before.value, after.value);
  const changes = collectChanges(root);
  const notes = statusNotes(data);
  if (before.loose || after.loose) notes.push('Parsed as JSON with comments');
  const summary = data.oldText !== null && data.newText !== null ? renderJsonSummary(changes) : '';
  return {
    html: `${summary}${renderJsonDiff(root)}`,
    stats: summarize(changes),
    notes,
    navigable: true,
    tree: true,
  };
}

export function errorHtml(message) {
  return `<div class="bbrd-error" role="alert"><strong>Couldn't build this view.</strong> ${escapeHtml(message)}</div>`;
}
