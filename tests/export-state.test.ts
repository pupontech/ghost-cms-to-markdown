import { describe, expect, it } from 'vitest';
import { createOutputState, resetOutputState } from '../src/export-state';

describe('resetOutputState', () => {
  it('clears selection, documents, successIds, search, and converting', () => {
    const state = createOutputState();
    state.selectedIds.add('a');
    state.selectedIds.add('b');
    state.documents.set('a', { filename: 'a.md', markdown: 'old', type: 'post' });
    state.successIds = ['a'];
    state.searchTerm = 'old-query';
    state.converting = true;

    resetOutputState(state);

    expect(state.selectedIds.size).toBe(0);
    expect(state.documents.size).toBe(0);
    expect(state.successIds).toEqual([]);
    expect(state.searchTerm).toBe('');
    expect(state.converting).toBe(false);
  });

  it('clears an already-empty state without throwing', () => {
    const state = createOutputState();
    expect(() => resetOutputState(state)).not.toThrow();
    expect(state.selectedIds.size).toBe(0);
  });
});