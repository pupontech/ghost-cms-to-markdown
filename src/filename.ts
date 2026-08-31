export interface FilenameSource {
  id: string;
  slug?: string;
  title?: string;
}

const MAX_STEM_LENGTH = 100;
const RESERVED_WINDOWS = new Set(
  [
    'CON', 'PRN', 'AUX', 'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
  ],
);

/** Derive a filesystem-safe kebab-case stem from a candidate, or null when empty. */
function sanitizeStem(candidate: string): string | null {
  let stem = candidate
    .replace(/[\u0000-\u001f\u007f]/g, '') // strip control characters
    .replace(/[<>:"/\\|?*]+/g, ' ') // turn Windows-reserved characters into separators
    .replace(/\s+/g, ' ') // collapse whitespace runs
    .trim()
    .toLowerCase();
  stem = stem
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+|\.+$/g, ''); // strip leading/trailing dots

  if (!stem) return null;

  stem = stem.slice(0, MAX_STEM_LENGTH).replace(/-+$/g, '');

  if (RESERVED_WINDOWS.has(stem.toUpperCase())) return null;

  return stem;
}

/**
 * Allocates deterministic, collision-free `.md` filenames.
 * Prefers the slug, then a normalized title, then the entry id. Every assigned
 * stem (including stems produced by suffixing) is reserved, so a later base
 * that collides with an already-suffixed name is bumped past it. Output order
 * matches the input order.
 */
export function allocateFilenames(sources: readonly FilenameSource[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>(); // every allocated (lowercased) stem, deduped

  for (const source of sources) {
    const candidates: Array<string | undefined> = [
      source.slug,
      source.title,
      source.id,
    ];

    let baseStem: string | null = null;

    for (const candidate of candidates) {
      const cleaned = sanitizeStem(candidate ?? '');
      if (cleaned === null) continue;
      baseStem = cleaned;
      break;
    }

    if (baseStem === null) {
      // The id can itself contain path/reserved/control characters in a
      // malformed export. Re-sanitize the fallback instead of emitting it.
      baseStem = sanitizeStem(`entry-${source.id}`) ?? 'entry';
    }

    let stem = baseStem;
    let counter = 2;
    // Keep bumping until we find a stem that has not already been allocated,
    // including stems that were themselves produced by suffixing earlier bases.
    while (used.has(stem)) {
      stem = `${baseStem}-${counter}`;
      counter += 1;
    }

    used.add(stem);
    result.set(source.id, `${stem}.md`);
  }

  return result;
}