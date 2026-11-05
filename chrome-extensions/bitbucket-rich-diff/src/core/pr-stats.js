import { isGeneratedFile, isMarkdownFile, isProjectFile } from './file-filter.js';
import { isTestFile } from './test-outline.js';

/**
 * Totals for the pull request, counted from the file list rather than from whatever is still visible.
 * A file can belong to more than one group: a project file inside a test folder counts as both.
 * @param {{ path: string, added?: number, removed?: number, tests?: number }[]} files
 */
export function summarizeFiles(files) {
  const summary = {
    files: files.length,
    added: 0,
    removed: 0,
    markdown: 0,
    testFiles: 0,
    tests: 0,
    projects: 0,
    generated: 0,
  };
  for (const file of files) {
    const added = file.added || 0;
    const removed = file.removed || 0;
    summary.added += added;
    summary.removed += removed;
    if (isMarkdownFile(file.path)) summary.markdown += 1;
    if (isTestFile(file.path)) {
      summary.testFiles += 1;
      summary.tests += file.tests || 0;
    }
    if (isProjectFile(file.path)) summary.projects += 1;
    if (isGeneratedFile(file.path)) summary.generated += 1;
  }
  return summary;
}
