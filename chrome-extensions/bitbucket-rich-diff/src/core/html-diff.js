import { diffArrays } from 'diff';

// Elements whose whole content is diffed as one unit, so a changed inline code span or image
// reads as "old removed, new inserted" instead of a confetti of fragments.
const ATOMIC_ELEMENTS = ['code', 'svg', 'math'];
const VOID_ATOMIC = /^<(img|br|hr|input)\b/i;

const TAG_RE = /^<\/?[a-zA-Z][^>]*>/;

/**
 * Splits HTML into tag tokens, atomic element tokens, whitespace runs and words.
 * Word tokens are letter/number runs; punctuation is tokenised per character.
 */
export function tokenizeHtml(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const rest = html.slice(i);
    if (rest[0] === '<') {
      const atomic = matchAtomic(rest);
      if (atomic) {
        tokens.push({ type: 'atomic', value: atomic });
        i += atomic.length;
        continue;
      }
      const tag = rest.match(TAG_RE);
      if (tag) {
        tokens.push({ type: VOID_ATOMIC.test(tag[0]) ? 'atomic' : 'tag', value: tag[0] });
        i += tag[0].length;
        continue;
      }
      const comment = rest.match(/^<!--[\s\S]*?-->/);
      if (comment) {
        i += comment[0].length;
        continue;
      }
    }
    const entity = rest.match(/^&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/);
    if (entity) {
      tokens.push({ type: 'word', value: entity[0] });
      i += entity[0].length;
      continue;
    }
    const ws = rest.match(/^\s+/);
    if (ws) {
      tokens.push({ type: 'space', value: ws[0] });
      i += ws[0].length;
      continue;
    }
    const word = rest.match(/^[\p{L}\p{N}_]+/u);
    if (word) {
      tokens.push({ type: 'word', value: word[0] });
      i += word[0].length;
      continue;
    }
    const ch = String.fromCodePoint(rest.codePointAt(0));
    tokens.push({ type: 'word', value: ch });
    i += ch.length;
  }
  return tokens;
}

function matchAtomic(rest) {
  for (const name of ATOMIC_ELEMENTS) {
    const open = new RegExp(`^<${name}\\b[^>]*>`, 'i');
    if (!open.test(rest)) continue;
    const close = `</${name}>`;
    const end = rest.toLowerCase().indexOf(close);
    if (end === -1) return null;
    return rest.slice(0, end + close.length);
  }
  return null;
}

const isText = (t) => t.type !== 'tag';

/**
 * Word-level diff of two HTML fragments that share a similar structure.
 * Returns merged HTML with <del class="bbrd-del"> and <ins class="bbrd-ins"> marks,
 * plus `ratio`: the larger of the share of old words removed and new words added
 * (0 = identical, 1 = fully rewritten).
 */
export function htmlDiff(oldHtml, newHtml) {
  const a = tokenizeHtml(oldHtml);
  const b = tokenizeHtml(newHtml);
  const parts = diffArrays(a, b, { comparator: (x, y) => x.type === y.type && x.value === y.value });

  let out = '';
  let same = 0;
  let removed = 0;
  let added = 0;

  const countWords = (tokens) => tokens.filter((t) => t.type === 'word' || t.type === 'atomic').length;

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part.added && !part.removed) {
      out += part.value.map((t) => t.value).join('');
      same += countWords(part.value);
      continue;
    }
    if (part.removed) {
      removed += countWords(part.value);
      out += wrapText(part.value.filter(isText), 'del');
    } else {
      added += countWords(part.value);
      out += wrapInserted(part.value);
    }
  }

  const share = (changed) => (changed === 0 ? 0 : changed / (same + changed));
  return { html: out, ratio: Math.max(share(removed), share(added)), changed: removed + added > 0 };
}

function wrapText(tokens, tagName) {
  const text = tokens.map((t) => t.value).join('');
  if (!text.trim()) return tagName === 'del' ? '' : text;
  return `<${tagName} class="bbrd-${tagName}">${text}</${tagName}>`;
}

function wrapInserted(tokens) {
  let out = '';
  let run = [];
  const flush = () => {
    out += wrapText(run, 'ins');
    run = [];
  };
  for (const t of tokens) {
    if (t.type === 'tag') {
      flush();
      out += t.value;
    } else {
      run.push(t);
    }
  }
  flush();
  return out;
}
