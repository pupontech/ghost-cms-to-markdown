// @vitest-environment node
// Proves the worker conversion path needs no jsdom/browser document.
import { describe, expect, it } from 'vitest';
import { handleWorkerMessage } from '../src/worker-handler';
import type { WorkerRequest, WorkerResponse } from '../src/worker-protocol';

function collect(message: WorkerRequest): WorkerResponse[] {
  const responses: WorkerResponse[] = [];
  handleWorkerMessage(message, (response) => responses.push(response));
  return responses;
}

describe('handleWorkerMessage (worker-safe, DOM-free)', () => {
  it('converts a batch and returns one result per item in order', () => {
    const responses = collect({
      kind: 'convertBatch',
      requestId: 7,
      items: [
        { entryId: 'a', html: '<p>Hello <strong>world</strong></p>' },
        { entryId: 'b', html: '<h1>Title</h1>' },
      ],
    });

    const batch = responses.find((r) => r.kind === 'batchResult');
    expect(responses).toHaveLength(1);
    expect(batch).toBeDefined();
    if (!batch || batch.kind !== 'batchResult') throw new Error('missing batchResult');

    expect(batch.requestId).toBe(7);
    const [first, second] = batch.results;
    expect(first.entryId).toBe('a');
    expect(first.conversion.ok).toBe(true);
    if (first.conversion.ok) expect(first.conversion.markdown).toContain('**world**');

    expect(second.entryId).toBe('b');
    if (second.conversion.ok) expect(second.conversion.markdown).toContain('# Title');
  });

  it('parses JSON text in the worker and returns the import outcome', () => {
    const responses: unknown[] = [];
    handleWorkerMessage({
      kind: 'parseExport',
      requestId: 11,
      text: JSON.stringify({
        db: [{ meta: {}, data: { posts: [{ id: 'p1', title: 'Worker post', type: 'post', html: '<p>body</p>' }] } }],
      }),
    } as unknown as WorkerRequest, (response) => responses.push(response));

    expect(responses).toHaveLength(1);
    const result = responses[0] as { kind?: string; requestId?: number; outcome?: { ok?: boolean; entries?: unknown[] } };
    expect(result.kind).toBe('parseResult');
    expect(result.requestId).toBe(11);
    expect(result.outcome?.ok).toBe(true);
    expect(result.outcome?.entries).toHaveLength(1);
  });

  it('strips XSS in the worker (script, handlers, javascript: URLs)', () => {
    const responses = collect({
      kind: 'convertBatch',
      requestId: 1,
      items: [
        { entryId: 's', html: '<p>ok</p><script>alert(1)</script>' },
        { entryId: 'h', html: '<p onclick="steal()">safe</p>' },
        { entryId: 'j', html: '<a href="javascript:evil()">click</a>' },
      ],
    });
    const batch = responses[0];
    if (!batch || batch.kind !== 'batchResult') throw new Error('missing batchResult');

    const get = (id: string) => {
      const r = batch!.results.find((x) => x.entryId === id)!;
      if (!r.conversion.ok) throw new Error('expected ok');
      return r.conversion.markdown;
    };
    expect(get('s')).not.toContain('alert');
    expect(get('s')).toContain('ok');
    expect(get('h')).not.toContain('steal');
    expect(get('j')).not.toContain('javascript:');
  });

  it('ignores unknown message kinds without responding', () => {
    const responses: WorkerResponse[] = [];
    handleWorkerMessage({ kind: 'terminate' }, (r) => responses.push(r));
    expect(responses).toHaveLength(0);
  });

  it('reports an empty-content failure for script-only entries', () => {
    const responses = collect({
      kind: 'convertBatch',
      requestId: 3,
      items: [{ entryId: 'e', html: '<script>alert(1)</script>' }],
    });
    const batch = responses[0];
    if (!batch || batch.kind !== 'batchResult') throw new Error('missing batchResult');
    expect(batch.results[0].conversion.ok).toBe(false);
    if (!batch.results[0].conversion.ok) expect(batch.results[0].conversion.code).toBe('empty-content');
  });
});