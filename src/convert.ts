import { sanitizeHtml } from './sanitize';
import { htmlToMarkdown } from './converter';

export interface ConvertResult {
  markdown: string;
  warnings: string[];
}

/**
 * Sanitizes untrusted Ghost HTML and converts it to GitHub-flavored Markdown.
 *
 * This implementation is fully DOM-free: sanitization runs on a pure (parse5)
 * tree and conversion uses pure HTML and Markdown syntax trees, so it produces
 * byte-identical output on the browser main thread, inside a Web Worker, and
 * under tests. Content that sanitizes away to nothing is reported as a warning
 * rather than silently dropped.
 */
export function convertMarkdown(html: string): ConvertResult {
  const safe = sanitizeHtml(html);
  const markdown = htmlToMarkdown(safe);

  const warnings =
    markdown.trim() === ''
      ? ['No safe content was found, so the entry was skipped.']
      : [];

  return { markdown, warnings };
}