import { describe, expect, it } from 'vitest';
import { computeSelection, type SelectableRow, type SelectionMode } from '../src/selection';

const rows: SelectableRow[] = [
  { id: 'a', status: 'published' },
  { id: 'b', status: 'published' },
  { id: 'c', status: 'draft' },
  { id: 'd', status: 'draft' },
];

function ids(set: Set<string>): string[] {
  return [...set].sort();
}

describe('computeSelection', () => {
  it('selects all visible rows for "all"', () => {
    expect(ids(computeSelection(rows, 'all'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects nothing for "none"', () => {
    expect(computeSelection(rows, 'none').size).toBe(0);
  });

  it('selects only published rows for "published"', () => {
    expect(ids(computeSelection(rows, 'published'))).toEqual(['a', 'b']);
  });

  it('selects only draft rows for "drafts"', () => {
    expect(ids(computeSelection(rows, 'drafts'))).toEqual(['c', 'd']);
  });

  it('replaces (does not accumulate) a prior selection', () => {
    // A stale additive selection must be replaced by the preset result.
    const before = new Set(['a', 'c']);
    const next = computeSelection(rows, 'published');
    expect(ids(next)).toEqual(['a', 'b']);
    expect(next.has('c')).toBe(false); // prior draft is dropped
    void before;
  });

  it('operates only over the visible (search-matched) rows', () => {
    const visible = rows.filter((r) => r.id === 'c' || r.id === 'a');
    expect(ids(computeSelection(visible, 'all'))).toEqual(['a', 'c']);
    expect(ids(computeSelection(visible, 'drafts'))).toEqual(['c']);
  });

  it('returns an empty set for an empty visible list', () => {
    expect(computeSelection([], 'all').size).toBe(0);
    expect(computeSelection([], 'published').size).toBe(0);
  });

  it('handles unknown statuses without matching them', () => {
    const mixed: SelectableRow[] = [
      { id: 'x', status: 'scheduled' },
      { id: 'y', status: 'published' },
    ];
    expect(ids(computeSelection(mixed, 'published' as SelectionMode))).toEqual(['y']);
  });
});