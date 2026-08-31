import { normalizeContent } from './normalizer';
import { convertMarkdown } from './convert';

/**
 * Outcome of converting a single entry's raw HTML to Markdown. Mirrors the
 * result of {@link buildDocuments} per-entry conversion so the worker and the
 * main-thread fallback produce identical outcomes.
 */
export type EntryConversion =
  | { ok: true; markdown: string; warnings: string[] }
  | { ok: false; code: 'no-content' | 'empty-content'; message: string };

/**
 * Converts a single entry's HTML into Markdown, reporting the two failure modes
 * the pipeline distinguishes: an entry with no usable HTML (`no-content`) and
 * an entry whose HTML sanitizes away to nothing (`empty-content`).
 *
 * Pure and DOM-free: runs identically on the main thread, inside a Web Worker,
 * and under tests.
 */
export function convertEntryHtml(html: string | null): EntryConversion {
  const content = normalizeContent({ html });
  if (!content.ok) {
    return { ok: false, code: content.error.code, message: content.error.message };
  }

  const { markdown, warnings } = convertMarkdown(content.html);
  if (markdown.trim() === '') {
    return {
      ok: false,
      code: 'empty-content',
      message: 'No safe content was found in this entry, so it cannot be converted.',
    };
  }

  return { ok: true, markdown, warnings };
}