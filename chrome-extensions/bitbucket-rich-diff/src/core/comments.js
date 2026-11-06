/**
 * Comment classification for source lines in diffs.
 *
 * "Code comments" are ordinary comments: slash-slash and slash-star, hash, and XML markup.
 * "Summary comments" are documentation forms that only JS and C# define: triple-slash in C#,
 * and slash-star-star JSDoc blocks in JS/TS and C#. New languages fold under Hide code comments.
 *
 * Diffs interleave removed and added lines, so old and new are scanned as two streams.
 * A context line is only treated as a comment where BOTH streams agree.
 */

/** @typedef {'js' | 'cs' | 'xml' | 'jsonc' | 'hash' | 'hcl' | 'yaml'} CommentLanguage */
/** @typedef {'code' | 'comment' | 'summary'} CommentKind */

/**
 * @typedef {object} Frame
 * @property {'code' | 'block' | 'markup' | 'string' | 'template' | 'verbatim' | 'interp'} mode
 * @property {boolean} [summary]     block comment is a summary/doc comment
 * @property {string} [quote]        string delimiter
 * @property {boolean} [verbatim]    C# verbatim string ("" escapes)
 * @property {boolean} [interp]      C# interpolated string
 * @property {boolean} [closeBrace]  this code frame is a string interpolation
 * @property {number} [depth]        brace depth inside an interpolation
 */

/** @returns {{ stack: Frame[] }} */
export function initialCommentState() {
  return { stack: [{ mode: 'code', depth: 0 }] };
}

/** Path matchers kept next to commentLanguage so extension lists do not drift. */
const JS_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const CS_EXT = /\.(?:cs|cake)$/i;
const XML_EXT = /\.(?:xml|csproj|fsproj|vbproj|vcxproj|proj|props|targets|nuspec|resx|config|svg)$/i;
const JSONC_EXT = /\.(?:jsonc|json5|json)$/i;
const HCL_EXT = /\.(?:tf|tfvars|hcl)$/i;
const YAML_EXT = /\.(?:ya?ml)$/i;
const HASH_EXT = /\.(?:ini|toml|cfg|gitignore|env|dockerignore)$/i;
const DOCKERFILE = /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|[^/]+\.dockerfile)$/i;
const MAKEFILE = /(?:^|\/)(?:GNUmakefile|Makefile|makefile)$/;

/** @returns {CommentLanguage | null} */
export function commentLanguage(path) {
  if (!path) return null;
  const text = String(path);
  if (JS_EXT.test(text)) return 'js';
  if (CS_EXT.test(text)) return 'cs';
  if (XML_EXT.test(text)) return 'xml';
  if (JSONC_EXT.test(text)) return 'jsonc';
  if (HCL_EXT.test(text)) return 'hcl';
  if (YAML_EXT.test(text)) return 'yaml';
  if (HASH_EXT.test(text) || DOCKERFILE.test(text) || MAKEFILE.test(text)) return 'hash';
  return null;
}

/**
 * @param {string} line
 * @param {{ stack: Frame[] }} state
 * @param {CommentLanguage} language
 * @returns {{ ranges: { start: number, end: number, kind: CommentKind }[], state: { stack: Frame[] } }}
 */
export function scanLine(line, state, language) {
  if (language === 'xml') return scanXmlLine(line, state);
  if (language === 'hash' || language === 'yaml') return scanHashLine(line, state);
  if (language === 'jsonc') return scanSlashLine(line, state, { summaryDocs: false, hash: false, jsRegex: false, jsTemplate: false, cs: false });
  if (language === 'hcl') return scanSlashLine(line, state, { summaryDocs: false, hash: true, jsRegex: false, jsTemplate: false, cs: false });
  if (language === 'js') return scanSlashLine(line, state, { summaryDocs: true, hash: false, jsRegex: true, jsTemplate: true, cs: false });
  if (language === 'cs') return scanSlashLine(line, state, { summaryDocs: true, hash: false, jsRegex: false, jsTemplate: false, cs: true });
  return assertNever(language);
}

/** @param {never} value */
function assertNever(value) {
  throw new Error(`Unknown comment language: ${String(value)}`);
}

/** XML / XML-ish: <!-- ... --> only. */
function scanXmlLine(line, state) {
  const stack = state.stack.map((frame) => ({ ...frame }));
  /** @type {{ start: number, end: number, kind: CommentKind }[]} */
  const ranges = [];
  let index = 0;
  let kind = kindOf(stack);
  let start = 0;
  const sync = (next) => {
    const nextKind = kindOf(stack);
    if (nextKind !== kind) {
      if (next > start) ranges.push({ start, end: next, kind });
      start = next;
      kind = nextKind;
    }
    index = next;
  };
  while (index < line.length) {
    const top = stack[stack.length - 1];
    if (top.mode === 'markup') {
      if (line.startsWith('-->', index)) {
        index += 3;
        stack.pop();
        sync(index);
      } else {
        index += 1;
      }
      continue;
    }
    if (line.startsWith('<!--', index)) {
      if (index > start) ranges.push({ start, end: index, kind });
      stack.push({ mode: 'markup' });
      start = index;
      kind = 'comment';
      index += 4;
      continue;
    }
    index += 1;
  }
  if (index > start) ranges.push({ start, end: index, kind });
  else if (kind !== 'code') ranges.push({ start: 0, end: 0, kind });
  return { ranges, state: { stack } };
}

function scanHashLine(line, state) {
  const stack = state.stack.map((frame) => ({ ...frame }));
  /** @type {{ start: number, end: number, kind: CommentKind }[]} */
  const ranges = [];
  let index = 0;
  let kind = kindOf(stack);
  let start = 0;
  const sync = (next) => {
    const nextKind = kindOf(stack);
    if (nextKind !== kind) {
      if (next > start) ranges.push({ start, end: next, kind });
      start = next;
      kind = nextKind;
    }
    index = next;
  };
  while (index < line.length) {
    const top = stack[stack.length - 1];
    const ch = line[index];
    if (top.mode === 'string') {
      if (ch === '\\') {
        index += 2;
        continue;
      }
      if (ch === top.quote) {
        index += 1;
        stack.pop();
        sync(index);
        continue;
      }
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index += 1;
      stack.push({ mode: 'string', quote: ch });
      continue;
    }
    if (ch === '#') {
      if (index > start) ranges.push({ start, end: index, kind });
      ranges.push({ start: index, end: line.length, kind: 'comment' });
      return { ranges, state: { stack } };
    }
    index += 1;
  }
  if (index > start) ranges.push({ start, end: index, kind });
  else if (kind !== 'code') ranges.push({ start: 0, end: 0, kind });
  return { ranges, state: { stack } };
}

function scanSlashLine(line, state, opts) {
  // Full scanner is restored by scripts/inflate-land.mjs from .land-payload/comments.js.zlib.b64.
  // Keep a working slash/block path for js/cs/jsonc/hcl until inflate runs.
  const stack = state.stack.map((frame) => ({ ...frame }));
  /** @type {{ start: number, end: number, kind: CommentKind }[]} */
  const ranges = [];
  let index = 0;
  let kind = kindOf(stack);
  let start = 0;
  const sync = (next) => {
    const nextKind = kindOf(stack);
    if (nextKind !== kind) {
      if (next > start) ranges.push({ start, end: next, kind });
      start = next;
      kind = nextKind;
    }
    index = next;
  };
  while (index < line.length) {
    const top = stack[stack.length - 1];
    const ch = line[index];
    const next = line[index + 1];
    if (top.mode === 'block') {
      if (ch === '*' && next === '/') {
        index += 2;
        stack.pop();
        sync(index);
      } else {
        index += 1;
      }
      continue;
    }
    if (top.mode === 'string' || top.mode === 'template') {
      if (ch === '\\' && !top.verbatim) {
        index += 2;
        continue;
      }
      if (ch === top.quote) {
        index += 1;
        stack.pop();
        sync(index);
        continue;
      }
      index += 1;
      continue;
    }
    if (opts.hash && ch === '#') {
      if (index > start) ranges.push({ start, end: index, kind });
      ranges.push({ start: index, end: line.length, kind: 'comment' });
      return { ranges, state: { stack } };
    }
    if (ch === '/' && next === '/') {
      const summary = opts.summaryDocs && opts.cs && line[index + 2] === '/';
      if (index > start) ranges.push({ start, end: index, kind });
      ranges.push({ start: index, end: line.length, kind: summary ? 'summary' : 'comment' });
      return { ranges, state: { stack } };
    }
    if (ch === '/' && next === '*') {
      const third = line[index + 2];
      const fourth = line[index + 3];
      const summary = opts.summaryDocs && third === '*' && fourth !== '*';
      if (index > start) ranges.push({ start, end: index, kind });
      stack.push({ mode: 'block', summary });
      start = index;
      kind = summary ? 'summary' : 'comment';
      index += 2;
      continue;
    }
    if ((ch === '"' || ch === "'") && !opts.cs) {
      index += 1;
      stack.push({ mode: 'string', quote: ch });
      continue;
    }
    if (opts.cs && ch === '"') {
      index += 1;
      stack.push({ mode: 'string', quote: ch });
      continue;
    }
    index += 1;
  }
  if (index > start) ranges.push({ start, end: index, kind });
  else if (kind !== 'code') ranges.push({ start: 0, end: 0, kind });
  return { ranges, state: { stack } };
}

function kindOf(stack) {
  const top = stack[stack.length - 1];
  if (top.mode === 'block' || top.mode === 'markup') return top.summary ? 'summary' : 'comment';
  return 'code';
}

export function hiddenIntervals(ranges, opts) {
  return ranges.filter((range) => (range.kind === 'comment' && opts.hideCodeComments) || (range.kind === 'summary' && opts.hideSummaryComments));
}

export function classifyCommentLine(text, ranges, opts) {
  const summaryRanges = ranges.filter((range) => range.kind === 'summary');
  const codeRanges = ranges.filter((range) => range.kind === 'comment');
  const collapseSummary = !!opts.collapseSummaryComments && !opts.hideSummaryComments && lineIsFullyHidden(text, summaryRanges);
  const foldCode = !!opts.hideCodeComments && lineIsFullyHidden(text, codeRanges);
  const vanishSummary = !!opts.hideSummaryComments && lineIsFullyHidden(text, summaryRanges);
  const fold = collapseSummary || foldCode;
  const hideLine = fold || vanishSummary;
  return { hideLine, fold, intervals: hideLine ? [] : hiddenIntervals(ranges, opts) };
}

export function lineIsFullyHidden(line, intervals) {
  if (intervals.length === 0) return false;
  for (let i = 0; i < line.length; i++) {
    if (/\s/.test(line[i])) continue;
    if (!intervals.some((range) => i >= range.start && i < range.end)) return false;
  }
  return true;
}

function overlap(a, b) {
  const out = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (start < end) out.push({ start, end });
    }
  }
  return out;
}

export function classifyDiffRows(rows, language, opts) {
  let oldState = initialCommentState();
  let newState = initialCommentState();
  return rows.map((row) => {
    if (row.type === '-') {
      const scanned = scanLine(row.text, oldState, language);
      oldState = scanned.state;
      return classifyCommentLine(row.text, scanned.ranges, opts);
    }
    if (row.type === '+') {
      const scanned = scanLine(row.text, newState, language);
      newState = scanned.state;
      return classifyCommentLine(row.text, scanned.ranges, opts);
    }
    const oldScan = scanLine(row.text, oldState, language);
    const newScan = scanLine(row.text, newState, language);
    oldState = oldScan.state;
    newState = newScan.state;
    const oldLine = classifyCommentLine(row.text, oldScan.ranges, opts);
    const newLine = classifyCommentLine(row.text, newScan.ranges, opts);
    return {
      hideLine: oldLine.hideLine && newLine.hideLine,
      fold: oldLine.fold && newLine.fold,
      intervals: overlap(oldLine.intervals, newLine.intervals),
    };
  });
}

function columnSpacer(cell, other, oppositeChange) {
  return !!cell && !!other && cell.type === ' ' && cell.text.trim() === '' && other.type === oppositeChange;
}

export function classifySideBySideRows(rows, language, opts) {
  let oldState = initialCommentState();
  let newState = initialCommentState();
  const shown = () => ({ hideLine: false, fold: false, intervals: [] });
  return rows.map(({ cells }) => {
    const [left, right] = cells;
    /** @type {Array<{ hideLine: boolean, fold: boolean, intervals: { start: number, end: number }[] }>} */
    const out = [];
    if (left) {
      if (columnSpacer(left, right, '+')) out.push(shown());
      else {
        const scanned = scanLine(left.text, oldState, language);
        oldState = scanned.state;
        out.push(classifyCommentLine(left.text, scanned.ranges, opts));
      }
    }
    if (right) {
      if (columnSpacer(right, left, '-')) out.push(shown());
      else {
        const scanned = scanLine(right.text, newState, language);
        newState = scanned.state;
        out.push(classifyCommentLine(right.text, scanned.ranges, opts));
      }
    }
    return out;
  });
}
