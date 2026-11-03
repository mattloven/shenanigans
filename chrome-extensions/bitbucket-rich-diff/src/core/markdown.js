import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

/**
 * @typedef {(url: string, kind: 'image' | 'link') => string} UrlResolver
 *
 * @typedef {object} MdBlock
 * @property {string} kind      e.g. "paragraph", "heading:h2", "bullet_list", "fence", "table"
 * @property {string} key       normalised markdown source, used to detect unchanged blocks
 * @property {string} html      rendered HTML of the block
 * @property {object[]} tokens  markdown-it tokens of the block (from the whole-document parse)
 */

let instance;

export function getMarkdownIt() {
  if (instance) return instance;
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  md.use(taskLists, { enabled: false, label: true });

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src && env?.resolveUrl) token.attrSet('src', env.resolveUrl(src, 'image'));
    token.attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, options, env, self);
  };

  const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (href && env?.resolveUrl) token.attrSet('href', env.resolveUrl(href, 'link'));
    if (href && !href.startsWith('#')) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  instance = md;
  return md;
}

export function renderMarkdown(src, { resolveUrl } = {}) {
  return getMarkdownIt().render(src, { resolveUrl });
}

/** Renders a token slice with the shared markdown-it renderer. */
export function renderTokens(tokens, env) {
  const md = getMarkdownIt();
  return md.renderer.render(tokens, md.options, env);
}

/**
 * Parses markdown into top-level blocks. Each block is rendered from the whole-document token
 * stream so reference-style links and definitions still resolve.
 * @returns {{ blocks: MdBlock[], env: object }}
 */
export function parseBlocks(src, { resolveUrl } = {}) {
  const env = { resolveUrl };
  const tokens = getMarkdownIt().parse(src, env);
  const lines = src.split('\n');
  return { blocks: splitBlocks(tokens, 0, tokens.length, lines, env), env };
}

/**
 * Splits tokens[start, end) into blocks at the nesting level of tokens[start].
 */
export function splitBlocks(tokens, start, end, lines, env) {
  const blocks = [];
  if (start >= end) return blocks;
  const level = tokens[start].level;
  let i = start;
  while (i < end) {
    const token = tokens[i];
    if (token.level !== level) {
      i++;
      continue;
    }
    let j = i + 1;
    if (token.nesting === 1) {
      let depth = 1;
      while (j < end && depth > 0) {
        depth += tokens[j].nesting;
        j++;
      }
    }
    const slice = tokens.slice(i, j);
    blocks.push({
      kind: blockKind(token),
      key: blockKey(token, slice, lines, env),
      html: renderTokens(slice, env),
      tokens: slice,
    });
    i = j;
  }
  return blocks;
}

function blockKind(token) {
  const base = token.type.replace(/_open$/, '');
  if (base === 'heading') return `heading:${token.tag}`;
  return base;
}

function blockKey(token, slice, lines, env) {
  if (token.map && lines) {
    return lines
      .slice(token.map[0], token.map[1])
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .trim();
  }
  return renderTokens(slice, env);
}

/** Plain text of a block, used for similarity scoring. */
export function blockText(block) {
  return block.tokens
    .map((t) => (t.type === 'inline' ? t.content : t.type === 'fence' || t.type === 'code_block' ? t.content : ''))
    .join(' ');
}
