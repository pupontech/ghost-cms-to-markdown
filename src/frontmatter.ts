export type FrontMatterKey =
  | 'title'
  | 'slug'
  | 'date'
  | 'updated'
  | 'author'
  | 'tags'
  | 'canonicalUrl';

export interface FrontMatterMetadata {
  title?: string | null;
  slug?: string | null;
  date?: string | null;
  updated?: string | null;
  author?: string | string[] | null;
  tags?: string[] | null;
  canonicalUrl?: string | null;
}

/** YAML key emitted for each model key, in canonical output order. */
const ORDER: FrontMatterKey[] = [
  'title',
  'slug',
  'date',
  'updated',
  'author',
  'tags',
  'canonicalUrl',
];

const KEY_TO_YAML: Record<FrontMatterKey, string> = {
  title: 'title',
  slug: 'slug',
  date: 'date',
  updated: 'updated',
  author: 'author',
  tags: 'tags',
  canonicalUrl: 'canonical_url',
};

/** Fields whose values are already safe to render unquoted (slugs, dates). */
const UNQUOTED = new Set<FrontMatterKey>(['slug', 'date', 'updated']);

function quoteScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function render(key: FrontMatterKey, value: string): string {
  const yamlKey = KEY_TO_YAML[key];
  const rendered = UNQUOTED.has(key) ? value : quoteScalar(value);
  return `${yamlKey}: ${rendered}`;
}

function renderList(values: readonly string[]): string {
  return values.map((v) => `  - ${quoteScalar(v)}`).join('\n');
}

/**
 * Renders metadata as a YAML front matter block with `---` delimiters.
 * Slugs and date fields are emitted unquoted; every other string is quoted
 * with escaping so it round-trips safely while preserving Unicode. Null and
 * undefined fields are omitted. When `fields` is provided only those keys are
 * considered; otherwise every present key is emitted in canonical order.
 * Returns an empty string when nothing is emitted.
 */
export function serializeFrontMatter(
  metadata: FrontMatterMetadata,
  fields?: readonly FrontMatterKey[],
): string {
  const active = fields ?? ORDER;
  const lines: string[] = [];

  for (const key of ORDER) {
    if (!active.includes(key)) continue;
    const raw = metadata[key];
    if (raw === null || raw === undefined) continue;

    if (key === 'tags' && Array.isArray(raw)) {
      if (raw.length === 0) continue;
      lines.push(`${KEY_TO_YAML[key]}:\n${renderList(raw)}`);
    } else if (key === 'author' && Array.isArray(raw)) {
      if (raw.length === 0) continue;
      lines.push(`${KEY_TO_YAML[key]}:\n${renderList(raw)}`);
    } else {
      lines.push(render(key, String(raw)));
    }
  }

  if (lines.length === 0) return '';
  return `---\n${lines.join('\n')}\n---\n`;
}