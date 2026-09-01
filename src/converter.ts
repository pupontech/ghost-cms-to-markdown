import { parseFragment } from 'parse5';
import { fromParse5 } from 'hast-util-from-parse5';
import { toMdast, type Handle } from 'hast-util-to-mdast';
import { toHtml } from 'hast-util-to-html';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Element } from 'hast';
import type { Html, Link } from 'mdast';

/**
 * Returns a string-valued HAST property without relying on a browser DOM.
 */
function property(node: Element, name: string): string | undefined {
  const value = node.properties?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Finds the direct media URL or the first safe <source> URL in a media node. */
function mediaSource(node: Element): string | undefined {
  const direct = property(node, 'src');
  if (direct) return direct;

  for (const child of node.children) {
    if (child.type !== 'element' || child.tagName !== 'source') continue;
    const source = property(child, 'src');
    if (source) return source;
  }

  return undefined;
}

/**
 * Markdown has no portable native video/audio block. A labeled link keeps the
 * external asset reachable without downloading it or emitting active HTML.
 */
function mediaHandler(label: string): Handle {
  return (state, node) => {
    const src = mediaSource(node);
    if (!src) return state.all(node);

    const result: Link = {
      type: 'link',
      title: property(node, 'title') ?? null,
      url: src,
      children: [{ type: 'text', value: label }],
    };
    state.patch(node, result);
    return result;
  };
}

function embedHandler(state: Parameters<Handle>[0], node: Element): Link | ReturnType<typeof state.all> {
  const src = property(node, 'src');
  if (!src) return state.all(node);

  const result: Link = {
    type: 'link',
    title: null,
    url: src,
    children: [{ type: 'text', value: property(node, 'title') ?? 'Embedded content' }],
  };
  state.patch(node, result);
  return result;
}

const ACTIVE_ELEMENTS = new Set(['audio', 'iframe', 'input', 'video']);

function containsActiveElement(node: Element): boolean {
  if (ACTIVE_ELEMENTS.has(node.tagName)) return true;
  return node.children.some(
    (child) => child.type === 'element' && containsActiveElement(child),
  );
}

function rawHtmlHandler(state: Parameters<Handle>[0], node: Element): Html | ReturnType<typeof state.all> {
  if (containsActiveElement(node)) return state.all(node);
  const result: Html = { type: 'html', value: toHtml(node) };
  state.patch(node, result);
  return result;
}

const HANDLERS: Record<string, Handle> = {
  audio: mediaHandler('Audio'),
  details: rawHtmlHandler,
  iframe: embedHandler,
  mark: rawHtmlHandler,
  sub: rawHtmlHandler,
  summary: rawHtmlHandler,
  sup: rawHtmlHandler,
  u: rawHtmlHandler,
  video: mediaHandler('Video'),
};

/**
 * Converts sanitized Ghost HTML into deterministic GitHub-flavored Markdown.
 *
 * The conversion uses the unified syntax-tree utilities rather than a DOM
 * renderer. `parse5` parses HTML, HAST models HTML semantics, `hast-util-to-
 * mdast` maps the structure to Markdown semantics, and the mdast serializer
 * emits escaped, deterministic GFM. All four steps are pure and therefore
 * produce the same result on the main thread, in a Web Worker, and in tests.
 */
export function htmlToMarkdown(html: string): string {
  const hast = fromParse5(parseFragment(html));
  const mdast = toMdast(hast, { handlers: HANDLERS });

  return toMarkdown(mdast, {
    bullet: '-',
    bulletOrdered: '.',
    emphasis: '_',
    strong: '*',
    fence: '`',
    fences: true,
    resourceLink: true,
    rule: '-',
    ruleRepetition: 3,
    extensions: [gfmToMarkdown()],
  }).trimEnd();
}
