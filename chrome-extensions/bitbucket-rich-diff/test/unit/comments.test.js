import { describe, expect, it } from 'vitest';
import { classifyDiffRows, classifySideBySideRows, commentLanguage, hiddenIntervals, scanLine, initialCommentState } from '../../src/core/comments.js';
import { isHiddenFile, parseExtensions, pathFromFileLink } from '../../src/core/file-filter.js';

const both = { hideCodeComments: true, hideSummaryComments: true };
const codeOnly = { hideCodeComments: true, hideSummaryComments: false };
const summaryOnly = { hideCodeComments: false, hideSummaryComments: true };

function hidden(line, language, opts, state = initialCommentState()) {
  const scanned = scanLine(line, state, language);
  return {
    text: hiddenIntervals(scanned.ranges, opts).map((range) => line.slice(range.start, range.end)).join('|'),
    state: scanned.state,
  };
}

describe('scanLine javascript', () => {
  it('hides line comments and trailing comments, but not comment markers inside strings or regexes', () => {
    expect(hidden('const a = 1; // trailing', 'js', codeOnly).text).toBe('// trailing');
    expect(hidden('// whole line', 'js', codeOnly).text).toBe('// whole line');
    expect(hidden('const url = "http://example.com"; // real', 'js', codeOnly).text).toBe('// real');
    expect(hidden('const t = `not // a comment`;', 'js', codeOnly).text).toBe('');
    expect(hidden('const r = /https?:\\/\\//g; // flags', 'js', codeOnly).text).toBe('// flags');
    expect(hidden('const n = 1 / 2;', 'js', codeOnly).text).toBe('');
  });

  it('treats /** as a summary comment and /* as a code comment, across lines', () => {
    expect(hidden('/* inline */ const a = 1;', 'js', codeOnly).text).toBe('/* inline */');
    expect(hidden('/** @param {string} name */', 'js', summaryOnly).text).toBe('/** @param {string} name */');
    expect(hidden('/** @param {string} name */', 'js', codeOnly).text).toBe('');
    expect(hidden('/**** banner ****/', 'js', codeOnly).text).toBe('/**** banner ****/');

    const first = hidden('/**', 'js', summaryOnly);
    expect(hidden(' * keeps going', 'js', summaryOnly, first.state).text).toBe(' * keeps going');
    const closed = hidden(' */ code();', 'js', summaryOnly, first.state);
    expect(closed.text.startsWith(' */')).toBe(true);
    expect(hidden('code(); // no', 'js', codeOnly, closed.state).text).toBe('// no');
  });

  it('lexes comments inside template interpolations', () => {
    expect(hidden('const t = `a ${1 // inside', 'js', codeOnly).text).toBe('// inside');
    const open = hidden('const t = `a ${', 'js', codeOnly);
    expect(hidden('  1 /* c */', 'js', codeOnly, open.state).text).toBe('/* c */');
  });
});

describe('scanLine csharp', () => {
  it('treats /// as summary comments and // as code comments', () => {
    expect(hidden('/// <summary>Charges a card.</summary>', 'cs', summaryOnly).text).toBe('/// <summary>Charges a card.</summary>');
    expect(hidden('/// <summary>Charges a card.</summary>', 'cs', codeOnly).text).toBe('');
    expect(hidden('var a = 1; // trailing', 'cs', codeOnly).text).toBe('// trailing');
    expect(hidden('var a = 1; /// not a doc, it is trailing', 'cs', summaryOnly).text).toBe('/// not a doc, it is trailing');
  });

  it('ignores comment-like text inside strings, verbatim strings and interpolations', () => {
    expect(hidden('var s = "http://host"; // real', 'cs', codeOnly).text).toBe('// real');
    expect(hidden('var s = @"line // still a string";', 'cs', codeOnly).text).toBe('');
    expect(hidden('var s = $"value {1}"; // real', 'cs', codeOnly).text).toBe('// real');
    expect(hidden("var c = '/';", 'cs', codeOnly).text).toBe('');
  });

  it('carries a verbatim string across lines so the next line is not a comment', () => {
    const open = hidden('var s = @"first', 'cs', codeOnly);
    expect(hidden('// still the string', 'cs', codeOnly, open.state).text).toBe('');
  });

  it('does not treat a quote character literal as the start of a string', () => {
    const rows = [
      { type: ' ', text: "var quote = '\"';" },
      { type: ' ', text: '    /// <summary>Still a doc comment.</summary>' },
      { type: ' ', text: '    // still a comment' },
    ];
    const result = classifyDiffRows(rows, 'cs', both);
    expect(result.map((row) => row.hideLine)).toEqual([false, true, true]);
  });
});

describe('classifyDiffRows', () => {
  it('lexes removed and added lines as separate streams', () => {
    const rows = [
      { type: ' ', text: 'function pay() {' },
      { type: '-', text: '  // old note' },
      { type: '+', text: '  // new note' },
      { type: ' ', text: '  return 1;' },
    ];
    const result = classifyDiffRows(rows, 'js', codeOnly);
    expect(result.map((row) => row.hideLine)).toEqual([false, true, true, false]);
  });

  it('keeps a context line when only one side thinks it is inside a comment', () => {
    const rows = [
      { type: '-', text: '/* removed opener' },
      { type: ' ', text: 'shared();' },
      { type: '+', text: 'added();' },
    ];
    const result = classifyDiffRows(rows, 'js', codeOnly);
    expect(result[1].hideLine).toBe(false);
    expect(result[2].hideLine).toBe(false);
  });

  it('hides a trailing comment without hiding the code in front of it', () => {
    const [row] = classifyDiffRows([{ type: '+', text: 'const a = 1; // note' }], 'js', codeOnly);
    expect(row.hideLine).toBe(false);
    expect(row.intervals.map(({ start, end }) => ({ start, end }))).toEqual([{ start: 13, end: 20 }]);
  });
});

describe('classifySideBySideRows', () => {
  it('hides a C# comment added opposite a blank cell without hiding the other column', () => {
    const rows = [
      { cells: [{ type: ' ', text: '    var before = 1;' }, { type: ' ', text: '    var before = 1;' }] },
      { cells: [{ type: ' ', text: '' }, { type: '+', text: '    // new note' }] },
      { cells: [{ type: '-', text: '    // old note' }, { type: '+', text: '    var after = 2;' }] },
      { cells: [{ type: ' ', text: '' }, { type: '+', text: '    /// <summary>Docs.</summary>' }] },
    ];
    const result = classifySideBySideRows(rows, 'cs', both);
    expect(result[1].map((cell) => cell.hideLine)).toEqual([false, true]);
    expect(result[2].map((cell) => cell.hideLine)).toEqual([true, false]);
    expect(result[3].map((cell) => cell.hideLine)).toEqual([false, true]);
  });

  it('keeps a block comment open down the new column only', () => {
    const rows = [
      { cells: [{ type: ' ', text: '' }, { type: '+', text: '    /* open' }] },
      { cells: [{ type: ' ', text: '    code();' }, { type: '+', text: '    still hidden' }] },
    ];
    const result = classifySideBySideRows(rows, 'cs', codeOnly);
    expect(result[1][0].hideLine).toBe(false);
    expect(result[1][1].hideLine).toBe(true);
  });
});

describe('commentLanguage', () => {
  it('recognises javascript, typescript and csharp paths', () => {
    expect(commentLanguage('src/app.js')).toBe('js');
    expect(commentLanguage('src/App.tsx')).toBe('js');
    expect(commentLanguage('src/Pay.cs')).toBe('cs');
    expect(commentLanguage('README.md')).toBeNull();
  });
});

describe('file filter', () => {
  const settings = { hideMarkdown: true, hiddenExtensions: ['.svg', '.min.js'] };

  it('parses typed extensions', () => {
    expect(parseExtensions('.SVG, lock  .min.js, nope!, .svg')).toEqual(['.svg', '.lock', '.min.js']);
    expect(parseExtensions(['.Lock'])).toEqual(['.lock']);
  });

  it('hides markdown and listed suffixes', () => {
    expect(isHiddenFile('docs/README.md', settings)).toBe(true);
    expect(isHiddenFile('docs/README.markdown', settings)).toBe(true);
    expect(isHiddenFile('icon.SVG', { hideMarkdown: false, hiddenExtensions: ['.svg'] })).toBe(true);
    expect(isHiddenFile('vendor/lib.min.js', settings)).toBe(true);
    expect(isHiddenFile('src/app.js', settings)).toBe(false);
    expect(isHiddenFile('README.md', { hideMarkdown: false, hiddenExtensions: [] })).toBe(false);
  });

  it('reads the file path out of a list link', () => {
    expect(pathFromFileLink('#chg-docs/README.md')).toBe('docs/README.md');
    expect(pathFromFileLink('https://bitbucket.org/a/b/pull-requests/1/diff#chg-a%20b.json')).toBe('a b.json');
    expect(pathFromFileLink('#overview')).toBeNull();
  });
});
