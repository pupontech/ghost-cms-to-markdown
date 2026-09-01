import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/main';
import { createFakeWorker, type FakeWorker } from './helpers/fake-worker';
import type { WorkerLike } from '../src/worker-host';

/**
 * Browser-flow smoke tests: drive the real SPA event handlers in jsdom,
 * covering Upload -> Select -> Convert -> Preview -> Download and front matter
 * output options.
 */

function exportJson(): string {
  return JSON.stringify({
    db: [
      {
        meta: { exported_on: 1, version: '5.0.0' },
        data: {
          posts: [
            {
              id: 'p1', title: 'Hello World', slug: 'hello-world', type: 'post',
              status: 'published', visibility: 'public',
              html: '<p>Welcome to <strong>my blog</strong>.</p>',
              created_at: '2026-08-31 10:00:00', updated_at: '2026-09-01 09:00:00',
              published_at: '2026-08-31 10:00:00', feature_image: null,
              canonical_url: null, custom_excerpt: null,
            },
            {
              id: 'p2', title: 'Second Post', slug: 'second-post', type: 'post',
              status: 'draft', visibility: 'public',
              html: '<h1>Second</h1><p>Draft body</p>',
              created_at: '2026-08-30 10:00:00', updated_at: '2026-08-30 10:00:00',
              published_at: null, feature_image: null, canonical_url: null,
              custom_excerpt: null,
            },
            {
              id: 'pg1', title: 'About', slug: 'about', type: 'page',
              status: 'published', visibility: 'public',
              html: '<p>About us</p>',
              created_at: '2026-01-01 10:00:00', updated_at: '2026-01-01 10:00:00',
              published_at: '2026-01-01 10:00:00', feature_image: null,
              canonical_url: null, custom_excerpt: null,
            },
          ],
        },
      },
    ],
  });
}

function mount(options?: { workerFactory?: () => WorkerLike }): ReturnType<typeof createApp> {
  const container = document.createElement('div');
  document.body.append(container);
  return createApp(container, options);
}

function deferredWorker(): {
  worker: FakeWorker;
  factory: () => WorkerLike;
  started: Promise<void>;
  release: () => void;
} {
  const worker = createFakeWorker();
  const originalPost = worker.postMessage.bind(worker);
  let release: (() => void) | undefined;
  let startedResolve!: () => void;
  let factoryCalls = 0;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  worker.postMessage = (message: unknown) => {
    startedResolve();
    release = () => originalPost(message);
  };
  return {
    worker,
    factory: () => {
      factoryCalls += 1;
      // The first and third calls are upload parsing; only the second call is
      // the conversion worker intentionally held by this test.
      return factoryCalls % 2 === 1 ? createFakeWorker() : worker;
    },
    started,
    release: () => {
      if (!release) throw new Error('conversion worker did not receive a request');
      release();
    },
  };
}

function deferredParseWorker(): {
  worker: FakeWorker;
  started: Promise<void>;
  release: () => void;
} {
  const worker = createFakeWorker();
  const originalPost = worker.postMessage.bind(worker);
  let release: (() => void) | undefined;
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  worker.postMessage = (message: unknown) => {
    const kind = (message as { kind?: unknown }).kind;
    if (kind !== 'parseExport') {
      originalPost(message);
      return;
    }
    startedResolve();
    release = () => originalPost(message);
  };
  return {
    worker,
    started,
    release: () => {
      if (!release) throw new Error('parse worker did not receive a request');
      release();
    },
  };
}

describe('browser flow (jsdom smoke)', () => {
  it('never renders credential-entry or remote-fetch controls', () => {
    mount();

    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('#api-key')).toBeNull();
    expect(document.querySelector('.api')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Content API key/i);
    expect(document.body.textContent).toMatch(/no credentials/i);
  });

  it('labels malformed and duplicate source rows as import skips', async () => {
    const app = mount();
    await app.loadExportText(JSON.stringify({
      db: [{
        meta: {},
        data: {
          posts: [
            null,
            { id: 'p1', title: 'First', slug: 'first', type: 'post', status: 'published', html: '<p>one</p>' },
            { id: 'p1', title: 'Duplicate', slug: 'duplicate', type: 'post', status: 'published', html: '<p>two</p>' },
          ],
        },
      }],
    }));

    const shellText = (document.body.lastElementChild as HTMLElement).textContent ?? '';
    expect(shellText).toContain('2 entries skipped during import.');
    expect(shellText).not.toContain('unsupported entry/entries skipped');
    expect(app.visibleRows()).toHaveLength(1);
  });

  it('surfaces malformed relation warnings in the import summary', async () => {
    const app = mount();
    await app.loadExportText(JSON.stringify({
      db: [{
        meta: {},
        data: {
          posts: [{ id: 'p1', title: 'First', slug: 'first', type: 'post', html: '<p>one</p>' }],
          tags: [null],
        },
      }],
    }));

    expect(app.visibleRows()).toHaveLength(1);
    expect(app.note()).toContain('1 import warning during import.');
  });

  it('parses and normalizes an export in the worker before rendering entries', async () => {
    const worker = createFakeWorker();
    const posted: unknown[] = [];
    const originalPost = worker.postMessage.bind(worker);
    worker.postMessage = (message: unknown) => {
      posted.push(message);
      originalPost(message);
    };

    const app = mount({ workerFactory: () => worker });
    await app.loadExportText(exportJson());

    expect(posted.some((message) => (
      typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === 'parseExport'
    ))).toBe(true);
    expect(app.visibleRows()).toHaveLength(3);
  });

  it('waits for the worker parse result before committing import state', async () => {
    const delayed = deferredParseWorker();
    const app = mount({ workerFactory: () => delayed.worker });
    let settled = false;
    const loading = app.loadExportText(exportJson()).then(() => {
      settled = true;
    });

    await delayed.started;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(app.visibleRows()).toHaveLength(0);

    delayed.release();
    await loading;
    expect(settled).toBe(true);
    expect(app.visibleRows()).toHaveLength(3);
  });

  it('ignores a stale worker parse result after a newer export starts', async () => {
    const delayed = deferredParseWorker();
    let factoryCalls = 0;
    const app = mount({
      workerFactory: () => {
        factoryCalls += 1;
        return factoryCalls === 1 ? delayed.worker : createFakeWorker();
      },
    });

    const stale = app.loadExportText(exportJson());
    await delayed.started;

    const fresh = JSON.stringify({
      db: [{ meta: {}, data: { posts: [{ id: 'fresh', title: 'Fresh', slug: 'fresh', type: 'post', status: 'published', html: '<p>fresh</p>' }] } }],
    });
    await app.loadExportText(fresh);
    expect(app.note()).toContain('1 posts or pages parsed.');
    expect(app.visibleRows().map((row) => row.id)).toEqual(['fresh']);

    delayed.release();
    await stale;
    expect(app.note()).toContain('1 posts or pages parsed.');
    expect(app.visibleRows().map((row) => row.id)).toEqual(['fresh']);
  });

  it('falls back to main-thread parsing when the worker is unavailable', async () => {
    let attempts = 0;
    const app = mount({
      workerFactory: () => {
        attempts += 1;
        throw new Error('worker unavailable');
      },
    });

    await app.loadExportText(exportJson());

    expect(attempts).toBe(1);
    expect(app.visibleRows()).toHaveLength(3);
  });

  it('upload -> select all -> convert -> preview -> results', async () => {
    const app = mount();
    const frontMatterToggle = document.querySelector<HTMLInputElement>('#fm-enabled');
    expect(frontMatterToggle).not.toBeNull();
    expect(frontMatterToggle?.checked).toBe(true);
    expect(document.querySelector('label[for="fm-enabled"]')).not.toBeNull();
    await app.loadExportText(exportJson());

    expect(app.visibleRows()).toHaveLength(3);
    expect(app.selectedIds()).toEqual([]);

    app.applySelection('all');
    expect(app.selectedIds().sort()).toEqual(['p1', 'p2', 'pg1']);

    const outcomes = await app.convert();
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((o) => o.ok)).toBe(true);

    expect(app.resultFilenames()).toEqual(['hello-world.md', 'second-post.md', 'about.md']);
    expect(app.note()).toContain('3 converted, 0 failed.');

    const preview = app.previewFirst();
    expect(preview).toContain('---\ntitle: "Hello World"');
    expect(preview).toContain('Welcome to **my blog**.');
  });

  it('keeps a per-entry failure isolated in the results', async () => {
    const app = mount();
    const json = JSON.parse(exportJson()) as { db: Array<{ data: { posts: Array<Record<string, unknown>> } }> };
    json.db[0].data.posts.push({
      id: 'bad', title: 'Bad', slug: 'bad', type: 'post', status: 'draft',
      html: '<script>evil()</script>', published_at: null,
    });
    await app.loadExportText(JSON.stringify(json));

    app.applySelection('all');
    const outcomes = await app.convert();
    const bad = outcomes.find((o) => o.entryId === 'bad');
    expect(bad?.ok).toBe(false);
    if (bad && bad.ok) throw new Error('expected failure');
    expect(app.note()).toContain('3 converted, 1 failed.');
  });

  it('search filters the visible selection surface', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.search('second');
    expect(app.visibleRows()).toHaveLength(1);
    expect(app.visibleRows()[0].id).toBe('p2');

    app.applySelection('all');
    expect(app.selectedIds()).toEqual(['p2']);
  });

  it('front matter can be turned off from the UI', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.frontMatter.setEnabled(false);
    expect(app.frontMatter.enabled()).toBe(false);

    app.applySelection('all');
    await app.convert();
    const preview = app.previewFirst();
    expect(preview).not.toContain('---\ntitle:');
    expect(preview).toContain('Welcome to **my blog**.');
  });

  it('front matter field selection limits emitted keys', async () => {
    const app = mount();
    await app.loadExportText(exportJson());

    app.frontMatter.setField('slug', false);
    app.frontMatter.setField('date', false);

    app.applySelection('all');
    await app.convert();
    const preview = app.previewFirst();
    expect(preview).toContain('title: "Hello World"');
    expect(preview).not.toContain('slug: hello-world');
    expect(preview).not.toContain('date:');
  });

  it('loading a new export clears the previous run’s results', async () => {
    const app = mount();
    await app.loadExportText(exportJson());
    app.applySelection('all');
    await app.convert();
    expect(app.resultFilenames()).toHaveLength(3);

    const fresh = JSON.stringify({
      db: [{ meta: {}, data: { posts: [{ id: 'x', title: 'Fresh', slug: 'fresh', type: 'post', status: 'published', html: '<p>new</p>' }] } }],
    });
    await app.loadExportText(fresh);

    expect(app.selectedIds()).toEqual([]);
    expect(app.resultFilenames()).toEqual([]);
    expect(app.note()).toContain('1 posts or pages parsed.');
    expect(app.visibleRows()).toHaveLength(1);
  });

  it('does not publish stale results or progress after a new export replaces it', async () => {
    const delayed = deferredWorker();
    const app = mount({ workerFactory: delayed.factory });
    const appShell = document.body.lastElementChild as HTMLElement;
    const progress = appShell.querySelector<HTMLProgressElement>('.progress');
    const progressStatus = appShell.querySelector<HTMLElement>('.progress-status');
    expect(progress).not.toBeNull();
    expect(progressStatus).not.toBeNull();
    await app.loadExportText(exportJson());
    app.applySelection('all');

    const converting = app.convert();
    await delayed.started;
    expect(progress?.hidden).toBe(false);
    expect(progressStatus?.textContent).toContain('Converting 0 / 3');

    const fresh = JSON.stringify({
      db: [{ meta: {}, data: { posts: [{ id: 'p1', title: 'Fresh', slug: 'fresh', type: 'post', status: 'published', html: '<p>fresh</p>' }] } }],
    });
    await app.loadExportText(fresh);
    expect(progress?.hidden).toBe(true);
    expect(progressStatus?.hidden).toBe(true);
    expect(progressStatus?.textContent).toBe('');

    delayed.release();
    await converting;

    expect(app.resultFilenames()).toEqual([]);
    expect(app.documents().size).toBe(0);
    expect(progress?.hidden).toBe(true);
    expect(progressStatus?.textContent).toBe('');
    expect(app.note()).toContain('1 posts or pages parsed.');
  });

  it('rejects invalid JSON and oversized files with clear messages', async () => {
    const app = mount();
    await app.loadExportText('not json');
    expect(app.visibleRows()).toHaveLength(0);

    // 51 MB fake file: the size gate fires before parsing.
    const big = JSON.stringify({ db: [{ meta: {}, data: { posts: [] } }] });
    await app.loadExportTextWithSize(big, 51 * 1024 * 1024);
    expect(app.visibleRows()).toHaveLength(0);
  });

  it('triggers individual Markdown and ZIP downloads from result controls', async () => {
    const app = mount();
    await app.loadExportText(exportJson());
    app.applySelection('all');
    await app.convert();

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const downloadedFilenames: string[] = [];
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilenames.push(this.download);
    });

    try {
      const shell = document.body.lastElementChild as HTMLElement;
      const markdownButtons = [...shell.querySelectorAll<HTMLButtonElement>('.result-row button')]
        .filter((button) => button.textContent === 'Download');
      expect(markdownButtons).toHaveLength(3);

      markdownButtons[0].click();
      expect(downloadedFilenames).toEqual(['hello-world.md']);

      const zipButton = shell.querySelector<HTMLButtonElement>('button.zip');
      expect(zipButton).not.toBeNull();
      zipButton?.click();
      await vi.waitFor(() => expect(downloadedFilenames).toEqual([
        'hello-world.md',
        'ghost-markdown-export.zip',
      ]));

      expect(createObjectURL).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      anchorClick.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }
  });

});
