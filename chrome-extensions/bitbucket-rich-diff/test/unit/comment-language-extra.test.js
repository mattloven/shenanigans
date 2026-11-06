import { describe, expect, it } from 'vitest';
import { commentLanguage, hiddenIntervals, scanLine, initialCommentState } from '../../src/core/comments.js';

const codeOnly = { hideCodeComments: true, hideSummaryComments: false };
const summaryOnly = { hideCodeComments: false, hideSummaryComments: true };

function hidden(line, language, opts, state = initialCommentState()) {
  const scanned = scanLine(line, state, language);
  return {
    text: hiddenIntervals(scanned.ranges, opts).map((range) => line.slice(range.start, range.end)).join('|'),
    state: scanned.state,
  };
}

describe('commentLanguage extra languages', () => {
  it('maps xml, jsonc, docker, terraform, yaml, cake and hash siblings', () => {
    expect(commentLanguage('data/values.xml')).toBe('xml');
    expect(commentLanguage('src/App.csproj')).toBe('xml');
    expect(commentLanguage('src/appsettings.json')).toBe('jsonc');
    expect(commentLanguage('tsconfig.jsonc')).toBe('jsonc');
    expect(commentLanguage('Dockerfile')).toBe('hash');
    expect(commentLanguage('docker/Dockerfile.prod')).toBe('hash');
    expect(commentLanguage('build/app.dockerfile')).toBe('hash');
    expect(commentLanguage('.dockerignore')).toBe('hash');
    expect(commentLanguage('infra/main.tf')).toBe('hcl');
    expect(commentLanguage('infra/vars.tfvars')).toBe('hcl');
    expect(commentLanguage('stack.hcl')).toBe('hcl');
    expect(commentLanguage('ci/pipeline.yml')).toBe('yaml');
    expect(commentLanguage('ci/pipeline.yaml')).toBe('yaml');
    expect(commentLanguage('build.cake')).toBe('cs');
    expect(commentLanguage('config.ini')).toBe('hash');
    expect(commentLanguage('pyproject.toml')).toBe('hash');
    expect(commentLanguage('app.cfg')).toBe('hash');
    expect(commentLanguage('.gitignore')).toBe('hash');
    expect(commentLanguage('.env')).toBe('hash');
    expect(commentLanguage('Makefile')).toBe('hash');
  });
});

describe('scanLine xml', () => {
  it('hides <!-- --> markup comments, including across lines, and leaves element text alone', () => {
    expect(hidden('<root><!-- gone --><child/></root>', 'xml', codeOnly).text).toBe('<!-- gone -->');
    expect(hidden('<note>not a comment</note>', 'xml', codeOnly).text).toBe('');
    const open = hidden('<a><!-- start', 'xml', codeOnly);
    expect(hidden('still comment', 'xml', codeOnly, open.state).text).toBe('still comment');
    const closed = hidden('end --> after', 'xml', codeOnly, open.state);
    expect(closed.text.startsWith('end -->')).toBe(true);
  });
});

describe('scanLine jsonc', () => {
  it('hides // and /* */ outside strings, and leaves comment markers inside strings alone', () => {
    expect(hidden('{ "a": 1 }, // trailing', 'jsonc', codeOnly).text).toBe('// trailing');
    expect(hidden('{ "url": "http://example.com" }', 'jsonc', codeOnly).text).toBe('');
    expect(hidden('{ "note": "/* not a comment */" }', 'jsonc', codeOnly).text).toBe('');
    expect(hidden('/* block */ { "a": 1 }', 'jsonc', codeOnly).text).toBe('/* block */');
    expect(hidden('/** looks like jsdoc but is a code comment */', 'jsonc', summaryOnly).text).toBe('');
    expect(hidden('/** looks like jsdoc but is a code comment */', 'jsonc', codeOnly).text).toBe('/** looks like jsdoc but is a code comment */');
  });
});

describe('scanLine hash languages', () => {
  it('hides Dockerfile # comments and leaves a hash inside quotes alone', () => {
    expect(hidden('# syntax=docker/dockerfile:1', 'hash', codeOnly).text).toBe('# syntax=docker/dockerfile:1');
    expect(hidden('RUN echo "not # a comment"', 'hash', codeOnly).text).toBe('');
    expect(hidden('COPY . /app # trailing', 'hash', codeOnly).text).toBe('# trailing');
  });
});

describe('scanLine hcl', () => {
  it('hides # and // line comments and /* */ blocks', () => {
    expect(hidden('  # terraform note', 'hcl', codeOnly).text).toBe('# terraform note');
    expect(hidden('  resource "x" "y" {} // trailing', 'hcl', codeOnly).text).toBe('// trailing');
    expect(hidden('  /* block */ resource "a" "b" {}', 'hcl', codeOnly).text).toBe('/* block */');
    expect(hidden('  name = "http://example.com"', 'hcl', codeOnly).text).toBe('');
  });
});

describe('scanLine yaml', () => {
  it('hides # comments at line start or after whitespace, not inside quotes', () => {
    expect(hidden('# top comment', 'yaml', codeOnly).text).toBe('# top comment');
    expect(hidden('  key: value # trailing', 'yaml', codeOnly).text).toBe('# trailing');
    expect(hidden('  key: "not # a comment"', 'yaml', codeOnly).text).toBe('');
  });
});

describe('scanLine cake', () => {
  it('treats .cake files as C#, so /// remains a summary comment', () => {
    expect(commentLanguage('build.cake')).toBe('cs');
    expect(hidden('/// <summary>Build.</summary>', 'cs', summaryOnly).text).toBe('/// <summary>Build.</summary>');
    expect(hidden('/// <summary>Build.</summary>', 'cs', codeOnly).text).toBe('');
    expect(hidden('Task("Default"); // note', 'cs', codeOnly).text).toBe('// note');
  });
});
