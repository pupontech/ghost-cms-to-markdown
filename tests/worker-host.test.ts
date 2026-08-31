import { describe, expect, it } from 'vitest';
import { createWorkerHost, type WorkerLike } from '../src/worker-host';
import { createFakeWorker } from './helpers/fake-worker';

describe('createWorkerHost', () => {
  it('is supported when a real worker factory is injected', () => {
    const host = createWorkerHost(() => createFakeWorker());
    expect(host.supported).toBe(true);
    host.dispose();
  });

  it('converts a batch through the typed protocol', async () => {
    const host = createWorkerHost(() => createFakeWorker());
    const results = await host.convert([
      { entryId: 'a', html: '<p>hello</p>' },
      { entryId: 'b', html: '<script>x()</script>' },
    ]);

    expect(results).not.toBeNull();
    if (!results) throw new Error('expected results');
    expect(results).toHaveLength(2);
    expect(results[0].entryId).toBe('a');
    if (results[0].conversion.ok) expect(results[0].conversion.markdown).toBe('hello');
    expect(results[1].conversion.ok).toBe(false);
    host.dispose();
  });

  it('falls back (resolves null) when the worker fails to start', async () => {
    const host = createWorkerHost(() => {
      throw new Error('boom');
    });
    expect(host.supported).toBe(true);
    const results = await host.convert([{ entryId: 'a', html: '<p>x</p>' }]);
    expect(results).toBeNull();
    host.dispose();
  });

  it('falls back when the worker errors at runtime', async () => {
    const fake = createFakeWorker(true); // failOnPost causes onerror
    const host = createWorkerHost(() => fake);
    const results = await host.convert([{ entryId: 'a', html: '<p>x</p>' }]);
    expect(results).toBeNull();
    host.dispose();
  });

  it('terminates the worker and stops serving on dispose', async () => {
    const fake = createFakeWorker();
    const host = createWorkerHost(() => fake);
    await host.convert([{ entryId: 'a', html: '<p>x</p>' }]); // spawns the worker
    expect(fake.terminated).toBe(false);
    host.dispose();
    expect(fake.terminated).toBe(true);
    const after = await host.convert([{ entryId: 'a', html: '<p>x</p>' }]);
    expect(after).toBeNull();
  });
});