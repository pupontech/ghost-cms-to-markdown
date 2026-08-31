import { parseFragment, serialize } from 'parse5';

/**
 * Minimal structural view of the parse5 default tree that we mutate. Kept local
 * so we never depend on the DOM or on parse5's indexed type map.
 */
interface PAttr {
  name: string;
  value: string;
}
interface PElement {
  nodeName: string;
  tagName: string;
  attrs: PAttr[];
  childNodes: PNode[];
  parentNode: PNode | null;
}
interface PText {
  nodeName: '#text';
  value: string;
  parentNode: PNode | null;
}
interface PComment {
  nodeName: '#comment';
  data: string;
  parentNode: PNode | null;
}
type PNode = PElement | PText | PComment;

/** Structural tags kept through sanitization and converted to Markdown. */
export const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'del',
  'div', 'dl', 'dt', 'dd', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
];

/** Attributes kept on the elements above. */
export const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'width', 'height', 'align',
  'target', 'rel',
];

const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR);

/**
 * Elements removed together with their entire subtree, regardless of whether
 * their name is otherwise trusted. These carry scripts, styling, or embedded
 * content that must never reach Markdown output.
 */
const STRIPPED_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
  'svg', 'math', 'form', 'input', 'button', 'select', 'textarea', 'option',
  'link', 'meta', 'base', 'head', 'title', 'frame', 'frameset', 'area',
  'map',
]);

/** Attributes that carry a URL and therefore need scheme checking. */
const URL_ATTRS = new Set(['href', 'src']);

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);
const SAFE_DATA_IMAGE = /^image\/(png|jpe?g|gif|webp);/i;

/** True when an attribute value uses a scheme that could execute or exfiltrate. */
function dangerousScheme(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020\u007f]/g, '').trim().toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!match) return false;
  const scheme = match[1];
  if (SAFE_SCHEMES.has(scheme)) return false;
  if (scheme === 'data') return !SAFE_DATA_IMAGE.test(normalized);
  return true;
}

function keepAttr(attr: PAttr): boolean {
  if (!ALLOWED_ATTR_SET.has(attr.name)) return false;
  if (URL_ATTRS.has(attr.name)) return !dangerousScheme(attr.value);
  return true;
}

function detach(node: PNode): void {
  const parent = node.parentNode as PElement | null;
  if (!parent) return;
  const index = parent.childNodes.indexOf(node);
  if (index === -1) return;
  parent.childNodes.splice(index, 1);
  node.parentNode = null;
}

function replaceWithChildren(node: PElement): void {
  const parent = node.parentNode as PElement | null;
  if (!parent) return;
  const index = parent.childNodes.indexOf(node);
  const children = node.childNodes;
  node.childNodes = [];
  node.parentNode = null;
  parent.childNodes.splice(index, 1, ...children);
  for (const child of children) child.parentNode = parent;
}

function sanitizeNode(node: PNode): void {
  if (node.nodeName === '#text') return;
  if (node.nodeName === '#comment') {
    detach(node);
    return;
  }

  const element = node as PElement;
  const tag = element.tagName.toLowerCase();
  if (!ALLOWED_TAG_SET.has(tag)) {
    if (STRIPPED_WITH_CONTENT.has(tag)) detach(element);
    else {
      // Unknown presentation wrappers are transparent, but their promoted
      // children still need the full sanitizer pass. Without this recursion,
      // a javascript: URL nested inside an unknown wrapper could survive.
      const children = [...element.childNodes];
      replaceWithChildren(element);
      for (const child of children) sanitizeNode(child);
    }
    return;
  }

  element.attrs = element.attrs.filter(keepAttr);
  for (const child of [...element.childNodes]) sanitizeNode(child);
}

/**
 * Sanitizes untrusted Ghost HTML into a canonical, safe HTML string by walking
 * a spec-compliant (parse5) tree and enforcing a strict allowlist. Disallowed
 * tags are dropped (with content for script-carrying elements), event handlers
 * and disallowed attributes are removed, and risky URL schemes are neutralized.
 *
 * This is a pure, DOM-free implementation: it runs identically on the main
 * thread, inside a Web Worker, and under tests, never touching `window` or
 * `document`.
 */
export function sanitizeHtml(html: string): string {
  const fragment = parseFragment(html);
  for (const child of [...fragment.childNodes]) sanitizeNode(child as PNode);
  return serialize(fragment);
}