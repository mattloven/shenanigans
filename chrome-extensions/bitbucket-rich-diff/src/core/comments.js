/**
 * Comment classification for JavaScript (and TypeScript) and C# source lines.
 *
 * "Code comments" are // line comments and /* block comments.
 * "Summary comments" are the documentation forms: /// XML docs in C#, and /** JSDoc
 * blocks in both languages. The two can be hidden independently.
 *
 * Diffs interleave removed and added lines, so old and new are scanned as two streams.
 * A context line is only treated as a comment where BOTH streams agree.
 */

/** @typedef {'js' | 'cs'} CommentLanguage */
/** @typedef {'code' | 'comment' | 'summary'} CommentKind */

/**
 * @typedef {object} Frame
 * @property {'code' | 'block' | 'string' | 'template' | 'verbatim' | 'interp'} mode
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

const JS_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const CS_EXT = /\.cs$/i;

/** @returns {CommentLanguage | null} */
export function commentLanguage(path) {
  if (!path) return null;
  if (JS_EXT.test(path)) return 'js';
  if (CS_EXT.test(path)) return 'cs';
  return null;
}

/**
 * @param {string} line
 * @param {{ stack: Frame[] }} state
 * @param {CommentLanguage} language
 * @returns {{ ranges: { start: number, end: number, kind: CommentKind }[], state: { stack: Frame[] } }}
 */
export function scanLine(line, state, language) {
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
    if (ch === '/' && next === '/') {
      const summary = language === 'cs' && line[index + 2] === '/';
      if (index > start) ranges.push({ start, end: index, kind });
      ranges.push({ start: index, end: line.length, kind: summary ? 'summary' : 'comment' });
      return { ranges, state: { stack } };
    }
    if (ch === '/' && next === '*') {
      const third = line[index + 2];
      const fourth = line[index + 3];
      const summary = third === '*' && fourth !== '*';
      if (index > start) ranges.push({ start, end: index, kind });
      stack.push({ mode: 'block', summary });
      // The opener belongs to the comment, so the new range starts at the slash.
      start = index;
      kind = summary ? 'summary' : 'comment';
      index += 2;
      continue;
    }
    if (language === 'cs' && (ch === '@' || ch === '$') && startsCsString(line, index)) {
      const opened = openCsString(line, index);
      index = opened.index;
      stack.push(opened.frame);
      continue;
    }
    if (language === 'cs' && ch === "'") {
      index += 1;
      if (line[index] === '\\') index += 2;
      else index += 1;
      if (line[index] === "'") index += 1;
      continue;
    }
    if (language === 'js' && ch === '`') {
      index += 1;
      stack.push({ mode: 'template', quote: '`' });
      continue;
    }
    if ((language === 'js' && (ch === '"' || ch === "'")) || (language === 'cs' && ch === '"')) {
      index += 1;
      stack.push({ mode: 'string', quote: ch });
      continue;
    }
    if (language === 'js' && ch === '/' && next !== '/' && next !== '*' && isRegexStart(line, index)) {
      index = consumeRegex(line, index + 1);
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
  if (top.mode === 'block') return top.summary ? 'summary' : 'comment';
  return 'code';
}

/** @param {string} line @param {number} index position of @ or $ */
function startsCsString(line, index) {
  const rest = line.slice(index);
  return /^(?:\$@|@\$|@|\$)"/.test(rest);
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

/** True when the line has nothing left to read once those intervals are removed. */
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

/**
 * Walks diff rows in display order, keeping separate lexing state for the old and new sides.
 * Context rows are hidden only where both sides agree.
 *
 * @param {Array<{ type: '+' | '-' | ' ', text: string }>} rows
 * @param {CommentLanguage} language
 * @param {{ hideCodeComments: boolean, hideSummaryComments: boolean }} opts
 * @returns {Array<{ hideLine: boolean, intervals: { start: number, end: number }[] }>}
 */
export function classifyDiffRows(rows, language, opts) {
  let oldState = initialCommentState();
  let newState = initialCommentState();
  return rows.map((row) => {
    if (row.type === '-') {
      const scanned = scanLine(row.text, oldState, language);
      oldState = scanned.state;
      const intervals = hiddenIntervals(scanned.ranges, opts);
      return { hideLine: lineIsFullyHidden(row.text, intervals), intervals };
    }
    if (row.type === '+') {
      const scanned = scanLine(row.text, newState, language);
      newState = scanned.state;
      const intervals = hiddenIntervals(scanned.ranges, opts);
      return { hideLine: lineIsFullyHidden(row.text, intervals), intervals };
    }
    const oldScan = scanLine(row.text, oldState, language);
    const newScan = scanLine(row.text, newState, language);
    oldState = oldScan.state;
    newState = newScan.state;
    const intervals = overlap(hiddenIntervals(oldScan.ranges, opts), hiddenIntervals(newScan.ranges, opts));
    return { hideLine: lineIsFullyHidden(row.text, intervals), intervals };
  });
}
