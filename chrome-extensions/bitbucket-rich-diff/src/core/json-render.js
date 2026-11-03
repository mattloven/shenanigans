import { diffWordsWithSpace } from 'diff';
import { escapeHtml } from './escape.js';
import { joinPath, kindOf } from './json-diff.js';

const FOLD_CONTEXT = 1;
const INLINE_STRING_DIFF_MIN = 24;
const SUMMARY_LIMIT = 200;

/**
 * Renders a JSON diff tree as an indented, collapsible tree.
 * Unchanged containers start collapsed; changed rows carry `data-bbrd-change`.
 * @param {import('./json-diff.js').JsonNode} root
 */
export function renderJsonDiff(root) {
  return `<div class="jd" role="tree">${renderNode(root, '', 0, { last: true })}</div>`;
}

/** Renders a plain JSON value as a collapsible tree (no diff state). */
export function renderJsonTree(value, { openDepth = 2 } = {}) {
  return `<div class="jd" role="tree">${renderValueNode({ status: 'unchanged', key: null, kind: kindOf(value), value }, '', 0, { openDepth })}</div>`;
}

function renderNode(node, parentPath, depth, opts) {
  const path = node.key === null ? '' : joinPath(parentPath, node.key);
  switch (node.status) {
    case 'unchanged':
      return renderValueNode(node, parentPath, depth, { openDepth: -1 });
    case 'added':
    case 'removed':
      return renderValueNode(node, parentPath, depth, { openDepth: Infinity, change: true });
    case 'modified':
      if (!node.children) return renderModifiedPrimitive(node, path, depth);
      return renderModifiedContainer(node, path, depth);
    default: {
      const unreachable = /** @type {never} */ (node.status);
      throw new Error(`Unknown status ${unreachable}`);
    }
  }
}

function renderModifiedContainer(node, path, depth) {
  const [open, close] = node.kind === 'array' ? ['[', ']'] : ['{', '}'];
  const pieces = node.children.map((child) => ({
    same: child.status === 'unchanged',
    html: renderNode(child, path, depth + 1, {}),
  }));
  return (
    `<details class="jd-node" open>` +
    `<summary class="${rowClass('modified', depth)}" data-path="${escapeHtml(path)}">${keyHtml(node.key)}<span class="jd-punc">${open}</span>` +
    `<span class="jd-collapsed"> … ${close}</span></summary>` +
    foldRuns(pieces) +
    `<div class="${rowClass('unchanged', depth)}"><span class="jd-punc">${close}</span></div>` +
    `</details>`
  );
}

function renderModifiedPrimitive(node, path, depth) {
  const kindChanged = kindOf(node.oldValue) !== 'primitive' || kindOf(node.newValue) !== 'primitive';
  let value;
  if (!kindChanged && typeof node.oldValue === 'string' && typeof node.newValue === 'string' && Math.min(node.oldValue.length, node.newValue.length) >= INLINE_STRING_DIFF_MIN) {
    value = `<span class="jd-str">"${inlineStringDiff(node.oldValue, node.newValue)}"</span>`;
  } else {
    value = `<del class="bbrd-del">${compactValueHtml(node.oldValue)}</del> <ins class="bbrd-ins">${compactValueHtml(node.newValue)}</ins>`;
  }
  return `<div class="${rowClass('modified', depth)}" data-path="${escapeHtml(path)}" data-bbrd-change>${keyHtml(node.key)}${value}</div>`;
}

function inlineStringDiff(a, b) {
  return diffWordsWithSpace(a, b)
    .map((part) => {
      const text = escapeHtml(escapeJsonString(part.value));
      if (part.added) return `<ins class="bbrd-ins">${text}</ins>`;
      if (part.removed) return `<del class="bbrd-del">${text}</del>`;
      return text;
    })
    .join('');
}

/**
 * Renders an unchanged, added or removed value. Containers become <details>, open while
 * depth < openDepth.
 */
function renderValueNode(node, parentPath, depth, { openDepth, change = false }) {
  const path = node.key === null ? '' : joinPath(parentPath, node.key);
  const status = node.status;
  const changeAttr = change ? ' data-bbrd-change' : '';
  const value = node.value;
  const kind = kindOf(value);

  if (kind === 'primitive') {
    return `<div class="${rowClass(status, depth)}" data-path="${escapeHtml(path)}"${changeAttr}>${keyHtml(node.key)}${primitiveHtml(value)}</div>`;
  }

  const entries = kind === 'array' ? value.map((v, i) => [i, v]) : Object.entries(value);
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) {
    return `<div class="${rowClass(status, depth)}" data-path="${escapeHtml(path)}"${changeAttr}>${keyHtml(node.key)}<span class="jd-punc">${open}${close}</span></div>`;
  }
  const count = `${entries.length} ${kind === 'array' ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;
  const children = entries
    .map(([k, v]) => renderValueNode({ status, key: k, kind: kindOf(v), value: v }, path, depth + 1, { openDepth }))
    .join('');
  return (
    `<details class="jd-node"${depth < openDepth ? ' open' : ''}>` +
    `<summary class="${rowClass(status, depth)}" data-path="${escapeHtml(path)}"${changeAttr}>${keyHtml(node.key)}<span class="jd-punc">${open}</span>` +
    `<span class="jd-collapsed"> … ${close} <span class="jd-meta">${count}</span></span></summary>` +
    children +
    `<div class="${rowClass(status, depth)}"><span class="jd-punc">${close}</span></div>` +
    `</details>`
  );
}

function rowClass(status, depth) {
  return `jd-row jd-row--${status} jd-d${Math.min(depth, 20)}`;
}

function keyHtml(key) {
  if (key === null) return '';
  if (typeof key === 'number') return `<span class="jd-index">${key}</span><span class="jd-punc">: </span>`;
  return `<span class="jd-key">"${escapeHtml(escapeJsonString(key))}"</span><span class="jd-punc">: </span>`;
}

function primitiveHtml(value) {
  if (value === null) return '<span class="jd-null">null</span>';
  switch (typeof value) {
    case 'string':
      return `<span class="jd-str">"${escapeHtml(escapeJsonString(value))}"</span>`;
    case 'number':
      return `<span class="jd-num">${value}</span>`;
    case 'boolean':
      return `<span class="jd-bool">${value}</span>`;
    default:
      return `<span>${escapeHtml(String(value))}</span>`;
  }
}

function compactValueHtml(value) {
  const kind = kindOf(value);
  if (kind === 'primitive') return primitiveHtml(value);
  const text = JSON.stringify(value);
  return `<span class="jd-inline">${escapeHtml(text.length > 120 ? `${text.slice(0, 117)}…` : text)}</span>`;
}

function escapeJsonString(s) {
  return JSON.stringify(s).slice(1, -1);
}

function foldRuns(pieces) {
  let out = '';
  let i = 0;
  while (i < pieces.length) {
    if (!pieces[i].same) {
      out += pieces[i++].html;
      continue;
    }
    let j = i;
    while (j < pieces.length && pieces[j].same) j++;
    const run = pieces.slice(i, j).map((p) => p.html);
    const leading = i === 0 ? 0 : FOLD_CONTEXT;
    const trailing = j === pieces.length ? 0 : FOLD_CONTEXT;
    if (run.length > leading + trailing + 1) {
      const hidden = run.slice(leading, run.length - trailing);
      out += run.slice(0, leading).join('');
      out += `<div class="bbrd-fold" data-count="${hidden.length}"><button type="button" class="bbrd-fold-toggle">Show ${hidden.length} unchanged</button><div class="bbrd-fold-body">${hidden.join('')}</div></div>`;
      out += run.slice(run.length - trailing).join('');
    } else {
      out += run.join('');
    }
    i = j;
  }
  return out;
}

/** Table of changed paths shown above the tree; rows link to tree rows via data-target-path. */
export function renderJsonSummary(changes) {
  if (changes.length === 0) return '<div class="jd-summary jd-summary--empty">No structural changes (formatting or key order only).</div>';
  const rows = changes
    .slice(0, SUMMARY_LIMIT)
    .map(
      (c) =>
        `<tr class="jd-sum-row jd-sum-row--${c.type}" data-target-path="${escapeHtml(c.path)}" tabindex="0">` +
        `<td class="jd-sum-type">${c.type === 'added' ? '+' : c.type === 'removed' ? '−' : '~'}</td>` +
        `<td class="jd-sum-path"><code>${escapeHtml(c.path || '(root)')}</code></td>` +
        `<td class="jd-sum-old">${'oldValue' in c ? compactValueHtml(c.oldValue) : ''}</td>` +
        `<td class="jd-sum-new">${'newValue' in c ? compactValueHtml(c.newValue) : ''}</td>` +
        `</tr>`,
    )
    .join('');
  const more = changes.length > SUMMARY_LIMIT ? `<div class="jd-summary-more">…and ${changes.length - SUMMARY_LIMIT} more changes</div>` : '';
  return `<div class="jd-summary"><table><thead><tr><th></th><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>${more}</div>`;
}
