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

/**
 * Shared scanner for languages whose comments use // and block comments (and optionally #).
 * @param {string} line
 * @param {{ stack: Frame[] }} state
 * @param {{ summaryDocs: boolean, hash: boolean, jsRegex: boolean, jsTemplate: boolean, cs: boolean }} opts
 */
function scanSlashLine(line, state, opts) {
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
      if (top.verbatim && ch === '"') {
        if (next === '"') {
          index += 2;
          continue;
        }
        index += 1;
        stack.pop();
        sync(index);
        continue;
      }
      if (top.interp && ch === '{') {
        if (next === '{') {
          index += 2;
          continue;
        }
        index += 1;
        stack.push({ mode: 'code', depth: 0, closeBrace: true });
        sync(index);
        continue;
      }
      if (top.interp && ch === '}' && next === '}') {
        index += 2;
        continue;
      }
      if (top.mode === 'template' && ch === '$' && next === '{') {
        index += 2;
        stack.push({ mode: 'code', depth: 0, closeBrace: true });
        sync(index);
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

    // Code.
    if (top.closeBrace && ch === '}') {
      if (top.depth) {
        top.depth -= 1;
        index += 1;
        continue;
      }
      index += 1;
      stack.pop();
      sync(index);
      continue;
    }
    if (ch === '{') {
      top.depth = (top.depth || 0) + 1;
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
    if (opts.cs && (ch === '@' || ch === '$') && startsCsString(line, index)) {
      const opened = openCsString(line, index);
      index = opened.index;
      stack.push(opened.frame);
      continue;
    }
    if (opts.cs && ch === "'") {
      index = consumeCsChar(line, index);
      continue;
    }
    if (opts.jsTemplate && ch === '`') {
      index += 1;
      stack.push({ mode: 'template', quote: '`' });
      continue;
    }
    if ((opts.jsTemplate || !opts.cs) && (ch === '"' || ch === "'")) {
      // js, jsonc, hcl: both quote styles. C# uses " via the branch below / csStrings.
      if (!opts.cs) {
        index += 1;
        stack.push({ mode: 'string', quote: ch });
        continue;
      }
    }
    if (opts.cs && ch === '"') {
      index += 1;
      stack.push({ mode: 'string', quote: ch });
      continue;
    }
    if (opts.jsRegex && ch === '/' && next !== '/' && next !== '*' && isRegexStart(line, index)) {
      index = consumeRegex(line, index + 1);
      continue;
    }
    index += 1;
  }

  if (index > start) ranges.push({ start, end: index, kind });
  else if (kind !== 'code') ranges.push({ start: 0, end: 0, kind });
  return { ranges, state: { stack } };
}

/** XML / XML-ish: <!-- ... --> only. No summary form; element text is not a comment. */
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

/**
 * Hash line comments (# …) for Docker, Makefile, ini/toml/cfg/env/gitignore, and YAML.
 * A # inside a single- or double-quoted string is left alone; quote state can span lines.
 */
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

function kindOf(stack) {
  const top = stack[stack.length - 1];
  if (top.mode === 'block' || top.mode === 'markup') return top.summary ? 'summary' : 'comment';
  return 'code';
}

/** @param {never} value */
function assertNever(value) {
  throw new Error(`Unknown comment language: ${String(value)}`);
}

/** @param {string} line @param {number} index position of @ or $ */
function startsCsString(line, index) {
  const rest = line.slice(index);
  return /^(?:\$@|@\$|@|\$)"/.test(rest);
}

/** A C# character literal, including '"' and '\'' so the quote cannot open a string. */
function consumeCsChar(line, index) {
  index += 1;
  if (index >= line.length) return index;
  if (line[index] === '\\') {
    const escape = line[index + 1];
    index += 2;
    if (escape === 'u') index += 4;
    else if (escape === 'U') index += 8;
  } else {
    index += 1;
  }
  if (line[index] === "'") index += 1;
  return index;
}

function openCsString(line, index) {
  let cursor = index;
  let verbatim = false;
  let interp = false;
  if (line[cursor] === '$') {
    interp = true;
    cursor += 1;
  }
  if (line[cursor] === '@') {
    verbatim = true;
    cursor += 1;
  }
  if (line[cursor] === '$') {
    interp = true;
    cursor += 1;
  }
  cursor += 1; // opening quote
  return { index: cursor, frame: { mode: verbatim ? 'string' : 'string', quote: '"', verbatim, interp } };
}

function isRegexStart(line, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(line[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  return !/[A-Za-z0-9_$)\]'"`]/.test(line[cursor]);
}

function consumeRegex(line, index) {
  let charClass = false;
  while (index < line.length) {
    const ch = line[index];
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (charClass) {
      if (ch === ']') charClass = false;
      index += 1;
      continue;
    }
    if (ch === '[') {
      charClass = true;
      index += 1;
      continue;
    }
    if (ch === '/') {
      index += 1;
      break;
    }
    index += 1;
  }
  while (index < line.length && /[a-z]/i.test(line[index])) index += 1;
  return index;
}

/**
 * Ranges to hide for one line.
 * @param {{ start: number, end: number, kind: CommentKind }[]} ranges
 * @param {{ hideCodeComments: boolean, hideSummaryComments: boolean }} opts
 */
export function hiddenIntervals(ranges, opts) {
  return ranges.filter((range) => (range.kind === 'comment' && opts.hideCodeComments) || (range.kind === 'summary' && opts.hideSummaryComments));
}

/**
 * A full summary line folds only when collapse is on and hide is off.
 * Hide removes it with no bar. A full code-comment line still folds when code comments are hidden.
 * @param {string} text
 * @param {{ start: number, end: number, kind: CommentKind }[]} ranges
 * @param {{ hideCodeComments: boolean, hideSummaryComments: boolean, collapseSummaryComments?: boolean }} opts
 * @returns {{ hideLine: boolean, fold: boolean, intervals: { start: number, end: number }[] }}
 */
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

/** True when the line has nothing left to read once those intervals are removed. */
export function lineIsFullyHidden(line, intervals) {
  if (intervals.length === 0) return false;
  for (let i = 0; i < line.length; i++) {
    if (/\s/.test(line[i])) continue;
    if (!intervals.some((range) => i >= range.start && i < range.end)) return false;
  }
  return true;
}

function overl