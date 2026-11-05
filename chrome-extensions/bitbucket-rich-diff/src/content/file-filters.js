import { CATEGORY_LABEL, CATEGORY_ORDER, compileHidePattern, fileCategory, formatHideSummary, isHiddenFolder, parseExtensions, pathFromFileLink } from '../core/file-filter.js';
import { findFileDiffs, getFilePath } from '../platform/bitbucket-cloud.js';

const COG_NAME = 'Global diff settings';
const MENU_LABEL = 'Hide files and comments';
const VIEWED_COUNTER = /^(\d+)\s+of\s+(\d+)\s+files?\s+viewed$/i;
const CHANGED_COUNTER = /^(\d+)\s+files?\s+changed$/i;
const ORIGINAL_VIEWED = 'bbrdViewedOriginal';
const ORIGINAL_CHANGED = 'bbrdChangedOriginal';

/** @type {WeakMap<HTMLElement, (key: string, value: unknown) => void>} */
const changeHandlers = new WeakMap();
/** @type {WeakSet<Document>} */
const wiredDocuments = new WeakSet();

/** Shown again for this visit only. A reload, or opening another pull request, hides them once more. */
let revealed = false;

/** @type {{ root: ParentNode, settings: import('../core/settings.js').Settings, onChange: (key: string, value: unknown) => void, commentOnly: Set<string> } | null} */
let lastApply = null;

/** Forget the temporary Show, so the next pull request starts from the saved hide rules. */
export function resetHiddenReveal() {
  revealed = false;
}

/**
 * Puts one Hide menu immediately to the left of Bitbucket's Files changed cog and hides matching
 * files in the list and the diff. Safe to call on every scan: a re-rendered toolbar is given the
 * same menu, and any older copy is removed.
 *
 * @param {ParentNode} root
 * @param {import('../core/settings.js').Settings} settings
 * @param {(key: string, value: unknown) => void} onChange
 * @param {Set<string>} [commentOnly] files whose whole diff is comments
 * @returns {number} how many files are hidden
 */
export function mountFileFilters(root, settings, onChange, commentOnly = new Set()) {
  lastApply = { root, settings, onChange, commentOnly };
  const doc = documentOf(root);
  ensureDismiss(doc);
  const cog = findCog(root);
  if (cog?.parentElement) {
    const host = ensureHost(doc, cog);
    const panel = ensurePanel(doc, onChange);
    for (const extra of doc.querySelectorAll('.bbrd-menu-host')) {
      if (extra !== host) extra.remove();
    }
    for (const extra of doc.querySelectorAll('.bbrd-filters')) {
      if (extra !== panel) extra.remove();
    }
    if (host.parentElement !== cog.parentElement || host.nextElementSibling !== cog) {
      cog.parentElement.insertBefore(host, cog);
    }
    if (panel.parentElement !== doc.body) doc.body.append(panel);
    syncPanel(panel, settings);
    if (!panel.hidden) placeMenu(host, panel);
  } else {
    removeLegacyPanels(doc);
  }
  return applyHidden(root, settings, commentOnly);
}

function documentOf(root) {
  if (root.nodeType === 9) return /** @type {Document} */ (root);
  return root.ownerDocument ?? document;
}

function findCog(root) {
  if (!root.querySelectorAll) return null;
  let match = null;
  for (const button of root.querySelectorAll('button')) {
    if (!(button instanceof HTMLButtonElement)) continue;
    if (button.closest('.bbrd-menu-host, [role=\"dialog\"]')) continue;
    if (!buttonName(button).includes(COG_NAME)) continue;
    if (!isShown(button)) continue;
    match = button;
  }
  return match;
}
