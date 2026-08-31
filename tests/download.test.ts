import { describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../src/download';

describe('downloadBlob', () => {
  it('performs a single download of the given blob and filename', () => {
    const trigger = vi.fn();
    const blob = new Blob(['# Hello'], { type: 'text/markdown' });

    downloadBlob(blob, 'hello.md', trigger);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0]).toBe(blob);
    expect(trigger.mock.calls[0][1]).toBe('hello.md');
  });

  it('refuses a filename that could escape into a path', () => {
    const trigger = vi.fn();
    downloadBlob(new Blob(['x']), '../evil.md', trigger);
    downloadBlob(new Blob(['x']), 'a/b.md', trigger);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing blob', () => {
    const trigger = vi.fn();
    downloadBlob(null, 'x.md', trigger);
    expect(trigger).not.toHaveBeenCalled();
  });
});