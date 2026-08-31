import { parseFragment } from 'parse5';

/**
 * Minimal structural view of the parse5 default tree, shared with the
 * sanitizer. The converter is pure and DOM-free so it runs identically on the
 * main thread, in a Web Worker, and under tests.
 */
interface PEl {
  nodeName: string;
  tagName: string;
  attrs: Array<{ name: string; value: string }>;
  childNodes: PNode[];
  parentNode: PNode | null;
}
interface PTx {
  nodeName: '#text';
  value: string;
  parentNode: PNode | null;
}
interface PCm {
  nodeName: '#comment';
  data: string;
  parentNode: PNode | null;
}
type PNode = PEl | PTx | PCm;

const HEADING_LEVEL: Record<string, number> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
};

const EMPHASIS: Record<string, [string, string]> = {
  strong: ['**', '**'],
  b: ['**', '**'],
  em: ['_', '_'],
  i: ['_', '_'],
  del: ['~~', '~~'],
  s: ['~~', '~~'],
  strike: ['~~', '~~'],
};

function isElement(node: PNode): node is PEl {
  return node.nodeName !== '#text' && node.nodeName !== '#comment';
}

/** Escapes markdown-significant characters in untrusted plain text. */
function escapeText(value: string): string {
  return value.replace(/[\\`]/g, '\\$&');
}

function attr(node: PEl, name: string): string | undefined {
  const found = node.attrs.find((a) => a.name === name);
  return found?.value;
}

/** Renders all inline children of a node as a flat string. */
function renderInlineChildren(node: PEl): string {
  let out = '';
  for (const child of node.childNodes) out += renderInline(child);
  return out;
}

/** Renders a single node assuming inline context; flattens nested blocks. */
function renderInline(node: PNode): string {
  if (node.nodeName === '#comment') return '';
  if (node.nodeName === '#text') return escapeText((node as PTx).value);

  const el = node as PEl;
  const tag = el.tagName.toLowerCase();

  const focus = EMPHASIS[tag];
  if (focus) {
    return focus[0] + renderInlineChildren(el) + focus[1];
  }

  if (tag === 'br') return '  \n';
  if (tag === 'sub') return `~${renderInlineChildren(el)}~`;
  if (tag === 'sup') return `^${renderInlineChildren(el)}^`;

  if (tag === 'code') {
    const text = renderInlineChildren(el);
    const fence = text.includes('`') ? '``' : '`';
    return `${fence}${text}${fence}`;
  }

  if (tag === 'a') return renderLink(el);
  if (tag === 'img') return renderImage(el);

  // span, abbr, cite, time, u, mark, small, and any unknown inline/block tags
  // are rendered transparently so their text is preserved inline.
  return renderInlineChildren(el);
}

function renderLink(node: PEl): string {
  const href = attr(node, 'href');
  const title = attr(node, 'title');
  const text = renderInlineChildren(node).trim();
  if (!href) return text;
  const url = href.replace(/\s+/g, '');
  const titlePart = title ? ` "${title}"` : '';
  return `[${text}](${url}${titlePart})`;
}

function renderImage(node: PEl): string {
  const src = attr(node, 'src');
  if (!src) return '';
  const alt = attr(node, 'alt') ?? '';
  const title = attr(node, 'title');
  const titlePart = title ? ` "${title}"` : '';
  return `![${alt}](${src.replace(/\s+/g, '')}${titlePart})`;
}

/** Renders element children as Markdown blocks joined by blank lines. */
function renderBlocks(node: PEl, depth = 0): string {
  const out: string[] = [];
  for (const child of node.childNodes) {
    if (child.nodeName === '#comment') continue;
    if (child.nodeName === '#text') {
      const text = escapeText((child as PTx).value).trim();
      if (text) out.push(text);
      continue;
    }

    const childEl = child as PEl;
    const tag = childEl.tagName.toLowerCase();
    const level = HEADING_LEVEL[tag];
    if (level !== undefined) {
      const text = renderInlineChildren(childEl).trim();
      if (text) out.push(`${'#'.repeat(level)} ${text}`);
      continue;
    }

    if (tag === 'p') {
      const text = renderInlineChildren(childEl).trim();
      if (text) out.push(text);
      continue;
    }

    if (tag === 'blockquote') {
      const inner = renderBlocks(childEl).trim();
      if (inner) out.push(inner.split('\n').map((line) => `> ${line || ''}`).join('\n'));
      continue;
    }

    if (tag === 'pre') {
      const text = innerText(childEl).replace(/^\n|\n$/g, '');
      const fence = text.includes('```') ? '````' : '```';
      out.push(`${fence}\n${text}\n${fence}`);
      continue;
    }

    if (tag === 'hr') {
      out.push('---');
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      out.push(renderList(childEl, depth).join('\n'));
      continue;
    }

    if (tag === 'table') {
      out.push(renderTable(childEl));
      continue;
    }

    if (tag === 'figure' || tag === 'div' || tag === 'section' || tag === 'dl') {
      const inner = renderBlocks(childEl, depth).trim();
      if (inner) out.push(inner);
      continue;
    }

    if (tag === 'figcaption') {
      const text = renderInlineChildren(childEl).trim();
      if (text) out.push(`_${text}_`);
      continue;
    }

    if (tag === 'dt' || tag === 'dd') {
      const text = renderInlineChildren(childEl).trim();
      if (text) out.push(text);
      continue;
    }

    // Any inline-ish element at block level is wrapped in a paragraph.
    const text = renderInline(childEl).trim();
    if (text) out.push(text);
  }
  return out.join('\n\n');
}

/** Returns raw text content of a node subtree (for <pre> blocks). */
function innerText(node: PEl): string {
  let out = '';
  for (const child of node.childNodes) {
    if (isElement(child)) out += innerText(child);
    else if (child.nodeName === '#text') out += (child as PTx).value;
  }
  return out;
}

function renderList(node: PEl, depth: number): string[] {
  const ordered = node.tagName.toLowerCase() === 'ol';
  const items = node.childNodes.filter(
    (c): c is PEl => isElement(c) && c.tagName.toLowerCase() === 'li',
  );
  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  let counter = 1;
  for (const item of items) {
    // Inline text of this item, excluding nested lists.
    let text = '';
    for (const child of item.childNodes) {
      const childTag = isElement(child) ? child.tagName.toLowerCase() : '';
      if (isElement(child) && (childTag === 'ul' || childTag === 'ol')) continue;
      text += renderInline(child);
    }
    text = text.trim();

    const marker = ordered ? `${counter}.` : '-';
    const body = text ? ` ${text}` : '';
    lines.push(`${indent}${marker}${body}`.trimEnd());

    // Nested lists render indented beneath this item.
    for (const child of item.childNodes) {
      if (!isElement(child)) continue;
      const childTag = child.tagName.toLowerCase();
      if (childTag === 'ul' || childTag === 'ol') {
        lines.push(...renderList(child, depth + 1));
      }
    }
    counter += 1;
  }
  return lines;
}

function renderTable(node: PEl): string {
  const rows: PEl[] = [];
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') rows.push(child);
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const cell of child.childNodes) {
        if (isElement(cell) && cell.tagName.toLowerCase() === 'tr') rows.push(cell);
      }
    }
  }

  // GFM tables need a header row; use the first row as the header.
  if (rows.length === 0) return '';
  const [header, ...body] = rows;

  const cells = (row: PEl): string[] =>
    row.childNodes
      .filter((c): c is PEl => isElement(c) && (c.tagName === 'th' || c.tagName === 'td'))
      .map((cell) =>
        renderInlineChildren(cell)
          .replace(/\|/g, '\\|')
          .replace(/\n/g, ' ')
          .trim(),
      );

  const headerCells = cells(header);
  const rowText = (cellsOf: string[]): string => `| ${cellsOf.join(' | ')} |`;
  const separatorCells = headerCells.map(() => '---');

  const out = [rowText(headerCells), rowText(separatorCells)];
  for (const row of body) out.push(rowText(cells(row)));
  return out.join('\n');
}

/**
 * Converts sanitized-safe HTML into GitHub-flavored Markdown. The input is
 * expected to have been sanitized (see {@link sanitizeHtml}); this renderer is
 * itself DOM-free and deterministic, so output is identical on the main thread
 * and in a Web Worker.
 */
export function htmlToMarkdown(html: string): string {
  const fragment = parseFragment(html);
  const node = {
    nodeName: '#document-fragment',
    tagName: '#document-fragment',
    attrs: [],
    childNodes: fragment.childNodes as unknown as PNode[],
    parentNode: null,
  } as PEl;
  return renderBlocks(node);
}