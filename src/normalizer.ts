export interface ContentSource {
  html: string | null;
}

export type ContentFormat = 'html';

export interface ContentError {
  code: 'no-content';
  message: string;
}

export type ContentOutcome =
  | { ok: true; html: string; sourceFormat: ContentFormat; warnings: string[] }
  | { ok: false; error: ContentError };

/**
 * Chooses the canonical conversion input for a source entry. For the current
 * slice, rendered HTML is the only supported input; later slices add Markdown
 * card payloads, Lexical, and Mobiledoc fallbacks in order. Entries with no
 * usable content fail with a user-readable reason.
 */
export function normalizeContent(source: ContentSource): ContentOutcome {
  const html = (source.html ?? '').trim();

  if (!html) {
    return {
      ok: false,
      error: {
        code: 'no-content',
        message: 'No HTML content is available for this entry, so it cannot be converted.',
      },
    };
  }

  return {
    ok: true,
    html,
    sourceFormat: 'html',
    warnings: [],
  };
}