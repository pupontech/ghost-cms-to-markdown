export interface NormalizedEntry {
  id: string;
  title: string;
  slug: string;
  type: 'post' | 'page';
  status: string;
  visibility: string;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  featureImage: string | null;
  canonicalUrl: string | null;
  customExcerpt: string | null;
  authors: string[];
  tags: string[];
  /** Canonical HTML content, or null when the export provides no body. */
  html: string | null;
  /** Origin of this entry: the user-provided Ghost JSON export. */
  source: 'json';
  warnings: string[];
}

export interface SkippedEntry {
  id: string;
  title: string;
  type: string;
  reason: string;
}

export type ImportErrorCode =
  | 'invalid-json'
  | 'invalid-root'
  | 'missing-db'
  | 'missing-bundle'
  | 'invalid-bundle';

export interface ImportError {
  code: ImportErrorCode;
  message: string;
}

export type ImportOutcome =
  | {
      ok: true;
      entries: NormalizedEntry[];
      skipped: SkippedEntry[];
      warnings: string[];
    }
  | { ok: false; error: ImportError };

const SUPPORTED_TYPES = new Set(['post', 'page']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strList(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function collectObjectRecords(
  value: unknown,
  collection: string,
  warnings: string[],
): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const item of strList(value)) {
    if (isObject(item)) records.push(item);
    else warnings.push(`Skipped malformed ${collection} record.`);
  }
  return records;
}

/** Normalizes a Ghost datetime to YYYY-MM-DD, or null when absent/invalid. */
function toDate(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? match[1] : null;
}

/**
 * Parses a Ghost JSON database export (the `db[]` envelope) into normalized
 * post/page entries with resolved author and tag relations. Returns a clear
 * import error on structural failure, and collects unsupported post types as
 * skipped entries rather than silently treating them as posts.
 */
export function parseGhostExport(input: unknown): ImportOutcome {
  if (!isObject(input)) {
    return {
      ok: false,
      error: {
        code: 'invalid-root',
        message: 'This file is not a Ghost export. Expected a JSON object with a "db" array.',
      },
    };
  }

  const db = input.db;
  if (!Array.isArray(db)) {
    return {
      ok: false,
      error: {
        code: 'missing-db',
        message: 'This file is not a valid Ghost export: the "db" array is missing.',
      },
    };
  }
  if (db.length === 0) {
    return {
      ok: false,
      error: {
        code: 'missing-bundle',
        message: 'This Ghost export does not contain any data bundles.',
      },
    };
  }

  const posts: unknown[] = [];
  const tags: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  const postsTags: Array<Record<string, unknown>> = [];
  const postsAuthors: Array<Record<string, unknown>> = [];
  const importWarnings: string[] = [];

  for (const bundle of db) {
    if (!isObject(bundle) || !isObject(bundle.data)) {
      return {
        ok: false,
        error: {
          code: 'invalid-bundle',
          message: 'This Ghost export bundle is malformed: expected a "data" object.',
        },
      };
    }
    const data = bundle.data;
    posts.push(...strList(data.posts));
    tags.push(...collectObjectRecords(data.tags, 'tags', importWarnings));
    users.push(...collectObjectRecords(data.users, 'users', importWarnings));
    postsTags.push(...collectObjectRecords(data.posts_tags, 'posts_tags', importWarnings));
    postsAuthors.push(...collectObjectRecords(data.posts_authors, 'posts_authors', importWarnings));
  }

  const tagByName = new Map<string, string>();
  for (const tag of tags) {
    const id = str(tag.id);
    const name = str(tag.name);
    if (id === null || id.trim() === '' || name === null || name.trim() === '') {
      importWarnings.push('Skipped malformed tags record.');
      continue;
    }
    if (tagByName.has(id)) {
      importWarnings.push(`Skipped duplicate tags id "${id}" record; keeping the first.`);
      continue;
    }
    tagByName.set(id, name);
  }

  const authorByName = new Map<string, string>();
  for (const user of users) {
    const id = str(user.id);
    const name = str(user.name);
    if (id === null || id.trim() === '' || name === null || name.trim() === '') {
      importWarnings.push('Skipped malformed users record.');
      continue;
    }
    if (authorByName.has(id)) {
      importWarnings.push(`Skipped duplicate users id "${id}" record; keeping the first.`);
      continue;
    }
    authorByName.set(id, name);
  }

  // Collect relation rows in relation-file order for stable output.
  const tagIdsByPost = new Map<string, string[]>();
  const authorIdsByPost = new Map<string, string[]>();

  for (const relation of postsTags) {
    const postId = str(relation.post_id);
    const tagId = str(relation.tag_id);
    if (postId === null || postId.trim() === '' || tagId === null || tagId.trim() === '') {
      importWarnings.push('Skipped malformed posts_tags relation.');
      continue;
    }
    const list = tagIdsByPost.get(postId) ?? [];
    list.push(tagId);
    tagIdsByPost.set(postId, list);
  }

  for (const relation of postsAuthors) {
    const postId = str(relation.post_id);
    const authorId = str(relation.author_id);
    if (postId === null || postId.trim() === '' || authorId === null || authorId.trim() === '') {
      importWarnings.push('Skipped malformed posts_authors relation.');
      continue;
    }
    const list = authorIdsByPost.get(postId) ?? [];
    list.push(authorId);
    authorIdsByPost.set(postId, list);
  }

  const entries: NormalizedEntry[] = [];
  const skipped: SkippedEntry[] = [];
  const seenEntryIds = new Set<string>();

  for (const rawPost of posts) {
    if (!isObject(rawPost)) {
      skipped.push({
        id: '',
        title: '',
        type: 'unknown',
        reason: 'Malformed source entry; expected an object with a source id.',
      });
      continue;
    }

    const id = str(rawPost.id) ?? '';
    const title = str(rawPost.title) ?? '';
    const slug = str(rawPost.slug) ?? '';
    const type = str(rawPost.type) ?? '';

    if (id.trim() === '') {
      skipped.push({
        id,
        title,
        type: type || 'unknown',
        reason: 'Missing source id; the entry was skipped to prevent selection collisions.',
      });
      continue;
    }

    if (!SUPPORTED_TYPES.has(type)) {
      skipped.push({
        id,
        title,
        type: type || 'unknown',
        reason: `Unsupported type "${type || 'missing'}"; only posts and pages are converted.`,
      });
      continue;
    }

    if (seenEntryIds.has(id)) {
      skipped.push({
        id,
        title,
        type,
        reason: `Duplicate source id "${id}"; only the first entry is converted.`,
      });
      continue;
    }
    seenEntryIds.add(id);

    const warnings: string[] = [];
    if (!title) warnings.push('Entry is missing a title.');

    const tagNameRefs = (tagIdsByPost.get(id) ?? [])
      .map((t) => tagByName.get(t))
      .filter((n): n is string => n !== undefined);
    const authorNameRefs = (authorIdsByPost.get(id) ?? [])
      .map((a) => authorByName.get(a))
      .filter((n): n is string => n !== undefined);

    entries.push({
      id,
      title,
      slug,
      type: type as 'post' | 'page',
      status: str(rawPost.status) ?? '',
      visibility: str(rawPost.visibility) ?? '',
      createdAt: toDate(rawPost.created_at),
      updatedAt: toDate(rawPost.updated_at),
      publishedAt: toDate(rawPost.published_at),
      featureImage: str(rawPost.feature_image),
      canonicalUrl: str(rawPost.canonical_url),
      customExcerpt: str(rawPost.custom_excerpt),
      authors: authorNameRefs,
      tags: tagNameRefs,
      html: str(rawPost.html),
      source: 'json',
      warnings,
    });
  }

  return { ok: true, entries, skipped, warnings: importWarnings };
}

/** Parses JSON text and then normalizes the Ghost export in one shared path. */
export function parseGhostExportText(text: string): ImportOutcome {
  try {
    return parseGhostExport(JSON.parse(text));
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid-json',
        message: 'This file is not valid JSON. Download the export again from Ghost.',
      },
    };
  }
}