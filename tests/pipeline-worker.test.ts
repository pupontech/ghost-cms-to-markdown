import { describe, expect, it } from 'vitest';
import { parseGhostExport, type NormalizedEntry } from '../src/parser';
import { buildDocuments, buildDocumentsAsync } from '../src/pipeline';
import { createFakeWorker } from './helpers/fake-worker';

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

describe('buildDocumentsAsync with a conversion worker', () => {
  it('matches the main-thread build when the worker succeeds', async () => {
    const entries = entriesOf([
      makePost(),
      makePost({ id: 'p2', slug: 'second', html: '<h1>Second</h1>' }),
      makePost({ id: 'bad', slug: 'bad', html: '<script>x()</script>' }),
    ]);

    const workerDocs = await buildDocumentsAsync(entries, {
      workerFactory: () => createFakeWorker(),
      chunkSize: 2,
    });
    expect(workerDocs).toEqual(buildDocuments(entries));
    expect(workerDocs.map((d) => d.ok)).toEqual([true, true, false]);
  });

  it('reports monotonic progress ending at the total', async () => {
    const entries = entriesOf(
      Array.from({ length: 10 }, (_, i) => makePost({ id: `p${i}`, slug: `s${i}` })),
    );
    const processed: number[] = [];
    const counts: Array<{ succeeded: number; failed: number }> = [];
    await buildDocumentsAsync(entries, {
      workerFactory: () => createFakeWorker(),
      chunkSize: 3,
      onProgress: (p) => {
        processed.push(p.processed);
        counts.push({ succeeded: p.succeeded, failed: p.failed });
      },
    });
    expect(processed[processed.length - 1]).toBe(10);
    expect(processed).toEqual([3, 6, 9, 10]);
    expect(counts[counts.length - 1]).toEqual({ succeeded: 10, failed: 0 });
  });

  it('falls back to the main thread when the worker cannot start', async () => {
    const entries = entriesOf([makePost(), makePost({ id: 'p2', slug: 'b' })]);
    const docs = await buildDocumentsAsync(entries, {
      workerFactory: () => {
        throw new Error('worker unavailable');
      },
    });
    expect(docs).toEqual(buildDocuments(entries));
    expect(docs.filter((d) => d.ok)).toHaveLength(2);
  });

  it('falls back to the main thread when the worker errors mid-run', async () => {
    const entries = entriesOf([
      makePost(),
      makePost({ id: 'p2', slug: 's2', html: '<p>two</p>' }),
      makePost({ id: 'p3', slug: 's3' }),
    ]);
    const docs = await buildDocumentsAsync(entries, {
      workerFactory: () => createFakeWorker(true), // errors on every post
      chunkSize: 2,
    });
    expect(docs).toEqual(buildDocuments(entries));
    expect(docs.filter((d) => d.ok)).toHaveLength(3);
  });

  it('converts large batches (1000 entries) off the main thread', async () => {
    const posts = Array.from({ length: 1000 }, (_, i) =>
      makePost({ id: `p${i}`, slug: `post-${i}`, title: `Post ${i}` }),
    );
    const entries = entriesOf(posts);
    const docs = await buildDocumentsAsync(entries, {
      workerFactory: () => createFakeWorker(),
      chunkSize: 25,
    });
    expect(docs).toHaveLength(1000);
    expect(docs.every((d) => d.ok)).toBe(true);
  }, 60000);
});