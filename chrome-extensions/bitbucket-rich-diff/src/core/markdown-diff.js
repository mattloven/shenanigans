import { alignSequences, wordSimilarity } from './align.js';
import { htmlDiff } from './html-diff.js';
import { parseBlocks, splitBlocks, renderTokens, blockText } from './markdown.js';
import { diffLines } from 'diff';
import { escapeHtml } from './escape.js';

/** Above this share of changed words a block is shown as "old removed, new inserted". */
const REWRITE_RATIO = 0.6;
/** Unchanged blocks kept visible around a change when unchanged runs are folded. */
const FOLD_CONTEXT = 1;

/**
 * @typedef {{ added: number, removed: number, modified: number }} ChangeStats
 */

/**
 * Builds a "track changes" rendering of a markdown file.
 *
 * Every changed unit carries `data-bbrd-change` so the UI can navigate between changes.
 * Runs of unchanged top-level blocks are wrapped in `.bbrd-fold` containers the UI can collapse.
 *
 * @param {string | null} oldSrc  null when the file was added
 * @param {string | null} newSrc  null when the file was deleted
 * @param {{ resolveOldUrl?: Function, resolveNewUrl?: Function }} [opts]
 * @returns {{ html: string, stats: ChangeStats }}
 */
export function diffMarkdown(oldSrc, newSrc, opts = {}) {
  const oldDoc = parseBlocks(oldSrc ?? '', { resolveUrl: opts.resolveOldUrl });
  const newDoc = parseBlocks(newSrc ?? '', { resolveUrl: opts.resolveNewUrl });
  const ctx = { stats: { added: 0, removed: 0, modified: 0 }, oldEnv: oldDoc.env, newEnv: newDoc.env };

  const ops = alignBlocks(oldDoc.blocks, newDoc.blocks);
  const pieces = ops.map((op) => ({ same: op.op === 'same', html: renderTopLevelOp(op, ctx) }));
  return { html: foldUnchanged(pieces), stats: ctx.stats };
}

/**
 * Pairs the top-level blocks of both versions into rows (no change markup), so a side-by-side
 * preview can keep matching sections level. A side is null where the block only exists in the
 * other version.
 * @returns {Array<{ old: string | null, new: string | null }>}
 */
export function alignMarkdownBlocks(oldSrc, newSrc, opts = {}) {
  const oldDoc = parseBlocks(oldSrc ?? '', { resolveUrl: opts.resolveOldUrl });
  const newDoc = parseBlocks(newSrc ?? '', { resolveUrl: opts.resolveNewUrl });
  return alignBlocks(oldDoc.blocks, newDoc.blocks).map((op) => ({ old: op.old?.html ?? null, new: op.new?.html ?? null }));
}

function alignBlocks(oldBlocks, newBlocks) {
  return alignSequences(oldBlocks, newBlocks, {
    key: (b) => `${b.kind}\u0000${b.key}`,
    similarity: (a, b) => (a.kind === b.kind ? wordSimilarity(blockText(a), blockText(b)) : 0),
    threshold: 0.3,
  });
}

function renderTopLevelOp(op, ctx) {
  switch (op.op) {
    case 'same':
      return op.new.html;
    case 'added':
      ctx.stats.added++;
      return wrapBlock(op.new.html, 'ins', true);
    case 'removed':
      ctx.stats.removed++;
      return wrapBlock(op.old.html, 'del', true);
    case 'pair':
      return renderModifiedBlock(op.old, op.new, ctx);
    default: {
      const unreachable = /** @type {never} */ (op.op);
      throw new Error(`Unknown op ${unreachable}`);
    }
  }
}

/**
 * @param {true | false | 'alt'} marker  true marks a change; 'alt' marks the inserted half of a
 *   replacement, which stands in for the change when deletions are hidden
 */
function markerAttr(marker) {
  if (marker === 'alt') return ' data-bbrd-alt';
  return marker ? ' data-bbrd-change' : '';
}

function wrapBlock(html, state, marker) {
  return `<div class="bbrd-blk bbrd-blk--${state}"${markerAttr(marker)}>${html}</div>`;
}

function replaceBlocks(oldHtml, newHtml, ctx) {
  ctx.stats.modified++;
  return wrapBlock(oldHtml, 'del', true) + wrapBlock(newHtml, 'ins', 'alt');
}

function renderModifiedBlock(oldBlock, newBlock, ctx) {
  const kind = newBlock.kind;
  if (kind === 'bullet_list' || kind === 'ordered_list') {
    return wrapBlock(renderListDiff(oldBlock, newBlock, ctx), 'mod', false);
  }
  if (kind === 'table') {
    const table = renderTableDiff(oldBlock, newBlock, ctx);
    if (table) return wrapBlock(table, 'mod', false);
    return replaceBlocks(oldBlock.html, newBlock.html, ctx);
  }
  if (kind === 'fence' || kind === 'code_block') {
    ctx.stats.modified++;
    return wrapBlock(renderCodeDiff(oldBlock.tokens[0], newBlock.tokens[0]), 'mod', true);
  }
  const diff = htmlDiff(oldBlock.html, newBlock.html);
  if (!diff.changed && oldBlock.html === newBlock.html) return newBlock.html;
  if (diff.ratio > REWRITE_RATIO) return replaceBlocks(oldBlock.html, newBlock.html, ctx);
  ctx.stats.modified++;
  return wrapBlock(diff.html, 'mod', true);
}

/** Diffs list items individually, keeping the list wrapper from the new version. */
function renderListDiff(oldBlock, newBlock, ctx) {
  const oldItems = childBlocks(oldBlock, ctx.oldEnv);
  const newItems = childBlocks(newBlock, ctx.newEnv);
  const ops = alignSequences(oldItems, newItems, {
    key: (b) => b.key,
    similarity: (a, b) => wordSimilarity(blockText(a), blockText(b)),
    threshold: 0.3,
  });

  const open = renderTokens([newBlock.tokens[0]], ctx.newEnv);
  const close = renderTokens([newBlock.tokens[newBlock.tokens.length - 1]], ctx.newEnv);
  let body = '';
  for (const op of ops) {
    switch (op.op) {
      case 'same':
        body += op.new.html;
        break;
      case 'added':
        ctx.stats.added++;
        body += markElement(op.new.html, 'ins', true);
        break;
      case 'removed':
        ctx.stats.removed++;
        body += markElement(op.old.html, 'del', true);
        break;
      case 'pair': {
        const diff = htmlDiff(op.old.html, op.new.html);
        if (diff.ratio > REWRITE_RATIO) {
          ctx.stats.modified++;
          body += markElement(op.old.html, 'del', true) + markElement(op.new.html, 'ins', 'alt');
        } else if (diff.changed) {
          ctx.stats.modified++;
          body += markElement(diff.html, 'mod', true);
        } else {
          body += op.new.html;
        }
        break;
      }
      default: {
        const unreachable = /** @type {never} */ (op.op);
        throw new Error(`Unknown op ${unreachable}`);
      }
    }
  }
  return open + body + close;
}

function childBlocks(block, env) {
  const inner = block.tokens.slice(1, -1);
  return splitBlocks(inner, 0, inner.length, null, env).map((child) => ({
    ...child,
    key: renderTokens(child.tokens, env),
  }));
}

/**
 * Row-level table diff. Returns null when the column layout changed, in which case the caller
 * shows the whole table as replaced.
 */
function renderTableDiff(oldBlock, newBlock, ctx) {
  const oldTable = tableParts(oldBlock, ctx.oldEnv);
  const newTable = tableParts(newBlock, ctx.newEnv);
  if (oldTable.columns !== newTable.columns) return null;

  let headHtml = newTable.head.html;
  if (oldTable.head.key !== newTable.head.key) {
    const diff = htmlDiff(oldTable.head.html, newTable.head.html);
    ctx.stats.modified++;
    headHtml = markElement(diff.html, 'mod', true);
  }

  const ops = alignSequences(oldTable.rows, newTable.rows, {
    key: (r) => r.key,
    similarity: (a, b) => wordSimilarity(a.text, b.text),
    threshold: 0.3,
  });
  let rowsHtml = '';
  for (const op of ops) {
    switch (op.op) {
      case 'same':
        rowsHtml += op.new.html;
        break;
      case 'added':
        ctx.stats.added++;
        rowsHtml += markElement(op.new.html, 'ins', true);
        break;
      case 'removed':
        ctx.stats.removed++;
        rowsHtml += markElement(op.old.html, 'del', true);
        break;
      case 'pair': {
        const diff = htmlDiff(op.old.html, op.new.html);
        ctx.stats.modified++;
        rowsHtml += markElement(diff.html, 'mod', true);
        break;
      }
      default: {
        const unreachable = /** @type {never} */ (op.op);
        throw new Error(`Unknown op ${unreachable}`);
      }
    }
  }
  return `<table>\n<thead>\n${headHtml}</thead>\n<tbody>\n${rowsHtml}</tbody>\n</table>\n`;
}

function tableParts(block, env) {
  const tokens = block.tokens;
  const rows = [];
  let head = null;
  let inHead = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'thead_open') inHead = true;
    if (t.type === 'thead_close') inHead = false;
    if (t.type !== 'tr_open') continue;
    let j = i;
    while (tokens[j].type !== 'tr_close') j++;
    const slice = tokens.slice(i, j + 1);
    const html = renderTokens(slice, env);
    const row = {
      html,
      key: html,
      text: slice.filter((x) => x.type === 'inline').map((x) => x.content).join(' '),
      cells: slice.filter((x) => x.type === 'th_open' || x.type === 'td_open').length,
    };
    if (inHead) head = row;
    else rows.push(row);
    i = j;
  }
  return { head, rows, columns: head ? head.cells : 0 };
}

function renderCodeDiff(oldToken, newToken) {
  const info = (newToken.info || '').trim().split(/\s+/)[0];
  const cls = info ? ` class="language-${escapeHtml(info)}"` : '';
  const parts = diffLines(oldToken.content, newToken.content);
  let body = '';
  for (const part of parts) {
    const state = part.added ? 'ins' : part.removed ? 'del' : 'same';
    for (const line of part.value.replace(/\n$/, '').split('\n')) {
      // Lines are display:block, so no newline between them (it would render as a blank line).
      body += `<span class="bbrd-code-line bbrd-code-line--${state}">${escapeHtml(line) || ' '}</span>`;
    }
  }
  return `<pre><code${cls}>${body}</code></pre>\n`;
}

/** Adds the change class (and optional change marker) to the first element of an HTML fragment. */
export function markElement(html, state, marker) {
  const attr = markerAttr(marker);
  return html.replace(/^(\s*)<([a-zA-Z][\w-]*)([^>]*)>/, (match, ws, tag, attrs) => {
    const classMatch = attrs.match(/\sclass="([^"]*)"/);
    const cls = `bbrd-el bbrd-el--${state}`;
    const newAttrs = classMatch ? attrs.replace(classMatch[0], ` class="${classMatch[1]} ${cls}"`) : `${attrs} class="${cls}"`;
    return `${ws}<${tag}${newAttrs}${attr}>`;
  });
}

/**
 * Wraps long runs of unchanged blocks in fold containers, keeping FOLD_CONTEXT blocks visible
 * next to each change.
 */
function foldUnchanged(pieces) {
  let out = '';
  let i = 0;
  while (i < pieces.length) {
    if (!pieces[i].same) {
      out += pieces[i].html;
      i++;
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
      out += `<div class="bbrd-fold" data-count="${hidden.length}"><button type="button" class="bbrd-fold-toggle">Show ${hidden.length} unchanged section${hidden.length === 1 ? '' : 's'}</button><div class="bbrd-fold-body">${hidden.join('')}</div></div>`;
      out += run.slice(run.length - trailing).join('');
    } else {
      out += run.join('');
    }
    i = j;
  }
  return out;
}
