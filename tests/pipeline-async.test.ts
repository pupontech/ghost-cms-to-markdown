import { describe, expect, it } from 'vitest';
import { parseGhostExport } from '../src/parser';
import { buildDocuments, buildDocumentsAsync } from '../src/pipeline';
import type { NormalizedEntry } from '../src/parser';

function exportWithPosts(posts: Array<Record<string, unknown>>) {
  return { db: [{ meta: {}, data: { posts } }] };
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: 'Hello World',
    slug: 'hello-world',
    html: '<p>Welcome to <strong>my blog</strong>.</p>',
    type: 'post',
    status: 'published',
    visibility: 'public',
    published_at: '2026-08-31 10:00:00',
    updated_at: '2026-09-01 09:00:00',
    tags: [],
    authors: [],
    ...overrides,
  };
}

function entriesOf(posts: Array<Record<string, unknown>>): NormalizedEntry[] {
  const out = parseGhostExport(exportWithPosts(posts));
  if (!out.ok) throw new Error('fixture should parse');
  return out.entries;
}

function makeMany(n: number): NormalizedEntry[] {
  const posts = Array.from({ length: n }, (_, i) =>
    makePost({ id: `p${i}`, slug: `post-${i}`, title: `Post ${i}` }),
  );
  return entriesOf(posts);
}

describe('buildDocumentsAsync', () => {
  it('allocates one global collision-safe filename set matching buildDocuments', async () => {
    const entries = entriesOf([
      makePost(),
      makePost({ id: 'p2' }),
      makePost({ id: 'p3', html: '<script>x()</script>' }),
      makePost({ id: 'p4', slug: 'hello-world' }),
    ]);
    const asyncDocs = await buildDocumentsAsync(entries);
    const syncDocs = buildDocuments(entries);
    expect(asyncDocs).toEqual(syncDocs);
    expect(
      asyncDocs.filter((d) => d.ok).map((d) => (d.ok ? d.filename : '')),
    ).toEqual(['hello-world.md', 'hello-world-2.md', 'hello-world-3.md']);
  });

  it('returns one outcome per input entry, in input order', async () => {
    const entries = entriesOf([
      makePost({ id: 'p1', slug: 'a' }),
      makePost({ id: 'p2', slug: 'b' }),
      makePost({ id: 'p3', slug: 'c' }),
    ]);
    const docs = await buildDocumentsAsync(entries);
    expect(docs.map((d) => d.entryId)).toEqual(['p1', 'p2', 'p3']);
    expect(docs.filter((d) => d.ok)).toHaveLength(3);
  });

  it('reports a per-entry failure without stopping the batch', async () => {
    const entries = entriesOf([
      makePost({ id: 'ok1', slug: 'first' }),
      makePost({ id: 'bad', slug: 'bad', html: '<script>evil()</script>' }),
      makePost({ id: 'ok2', slug: 'third' }),
    ]);
    const docs = await buildDocumentsAsync(entries);
    expect(docs.map((d) => d.ok)).toEqual([true, false, true]);
    const bad = docs[1];
    if (bad.ok) throw new Error('expected failure');
    expect(bad.error.code).toBe('empty-content');
    const first = docs[0];
    if (!first.ok) throw new Error('expected success');
    expect(first.filename).toBe('first.md');
    const third = docs[2];
    if (!third.ok) throw new Error('expected success');
    expect(third.filename).toBe('third.md');
  });

  it('reports monotonic progress that ends at the total', async () => {
    const entries = makeMany(10);
    const processed: number[] = [];
    const counts: Array<{ succeeded: number; failed: number }> = [];
    await buildDocumentsAsync(entries, {
      chunkSize: 3,
      onProgress: (p) => {
        processed.push(p.processed);
        counts.push({ succeeded: p.succeeded, failed: p.failed });
      },
    });
    expect(processed[processed.length - 1]).toBe(10);
    for (let i = 1; i < processed.length; i += 1) {
      expect(processed[i]).toBeGreaterThanOrEqual(processed[i - 1]);
    }
    // chunkSize 3 over 10 entries yields one progress report per completed batch.
    expect(processed).toEqual([3, 6, 9, 10]);
    expect(counts[counts.length - 1]).toEqual({ succeeded: 10, failed: 0 });
  });

  it('reports failure counts in progress callbacks', async () => {
    const entries = entriesOf([
      makePost({ id: 'ok', slug: 'good' }),
      makePost({ id: 'bad', slug: 'bad', html: '<script>x</script>' }),
    ]);
    const counts: Array<{ succeeded: number; failed: number }> = [];
    await buildDocumentsAsync(entries, {
      onProgress: (p) =>
        counts.push({ succeeded: p.succeeded, failed: p.failed }),
    });
    expect(counts[counts.length - 1]).toEqual({ succeeded: 1, failed: 1 });
  });

  it('converts 1, 10, 100, and 1000 generated entries', async () => {
    for (const n of [1, 10, 100, 1000]) {
      const entries = makeMany(n);
      const docs = await buildDocumentsAsync(entries);
      expect(docs).toHaveLength(n);
      expect(docs.every((d) => d.ok)).toBe(true);
    }
  }, 60000);

  it('returns an empty list for no entries without throwing', async () => {
    const docs = await buildDocumentsAsync([]);
    expect(docs).toEqual([]);
  });
});