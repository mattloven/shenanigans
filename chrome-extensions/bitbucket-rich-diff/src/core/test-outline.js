import { TEST_FOLDER } from './file-filter.js';

/**
 * A test file is one Geld-style outline is worth drawing: it lives in a *Tests folder,
 * or its name is a JS test/spec or a C# *Tests.cs file.
 * @param {string | null | undefined} path
 */
export function isTestFile(path) {
  if (!path) return false;
  const segments = String(path).split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some((segment) => TEST_FOLDER.test(segment))) return true;
  if (/\\.(?:test|spec)\\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(name)) return true;
  if (/(?:Tests?|Specs?)\\.cs$/i.test(name)) return true;
  return false;
}

const JS_HEADER = /^\\s*(?:describe|it|test|fit|xit|it\\.each|test\\.each|it\\.only|test\\.only)\\s*\\(\\s*(['"`])([^'"`]*)\\1/;
const CS_ATTR = /\\[(Fact|Theory|TestMethod|Test|TestCase)\\b([^\\]]*)\\]/;
const DISPLAY_NAME = /DisplayName\\s*=\\s*\"([^\"]*)\"/;
const METHOD_NAME = /\\b([A-Za-z_]\\w*)\\s*\\(/;
const DECLARATION = /^\\s*(?:public|private|protected|internal)\\b/;

/**
 * @param {string} text
 * @returns {string | null}
 */
function jsTitle(text) {
  const match = text.match(JS_HEADER);
  if (!match) return null;
  if (/^describe\\b/.test(text.trim())) return null;
  return match[2] || 'test';
}

/**
 * Groups a test file into one span per test. The span starts at the header line and runs
 * up to, but not including, the next header. C# attributes stay with the method they decorate.
 * @param {{ text: string }[]} lines
 * @param {'js' | 'cs'} language
 * @returns {{ title: string, start: number, end: number }[]}
 */
export function findTestSpans(lines, language) {
  /** @type {{ index: number, title: string }[]} */
  const headers = [];
  if (language === 'js') {
    lines.forEach((line, index) => {
      const title = jsTitle(line.text);
      if (title) headers.push({ index, title });
    });
  } else if (language === 'cs') {
    let pending = null;
    let pendingTitle = null;
    const closePending = (index) => {
      if (pending == null) return;
      const method = lines[index]?.text.match(METHOD_NAME);
      const title = pendingTitle || (method ? method[1].replace(/_/g, ' ') : 'Test');
      headers.push({ index: pending, title });
      pending = null;
      pendingTitle = null;
    };
    lines.forEach((line, index) => {
      const attr = line.text.match(CS_ATTR);
      if (attr) {
        if (pending == null) pending = index;
        const display = attr[2].match(DISPLAY_NAME);
        if (display?.[1]) pendingTitle = display[1];
        if (DECLARATION.test(line.text)) closePending(index);
        return;
      }
      if (pending != null && DECLARATION.test(line.text)) closePending(index);
    });
    if (pending != null) closePending(lines.length - 1);
  } else {
    const unknown = language;
    return assertNever(unknown);
  }
  return headers
    .map((header, index) => ({
      title: header.title,
      start: header.index,
      end: (headers[index + 1]?.index ?? lines.length) - 1,
    }))
    .filter((span) => span.end >= span.start);
}

/**
 * @param {never} value
 */
function assertNever(value) {
  throw new Error(`Unknown test language: ${String(value)}`);
}
