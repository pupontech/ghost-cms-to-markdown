export type SelectionMode = 'all' | 'none' | 'published' | 'drafts';

export interface SelectableRow {
  id: string;
  status: string;
}

/**
 * Computes the new selected-ids set for a replacement selection operation over
 * the *visible* (search/filter-matched) rows. Each preset replaces the entire
 * selection rather than adding to it, so `Select all` never accumulates and
 * `Published`/`Drafts` never leave non-matching rows selected.
 */
export function computeSelection(
  visible: readonly SelectableRow[],
  mode: SelectionMode,
): Set<string> {
  const selected = new Set<string>();
  if (mode === 'none') return selected;

  for (const row of visible) {
    const matches =
      mode === 'all' ||
      (mode === 'published' && row.status === 'published') ||
      (mode === 'drafts' && row.status === 'draft');
    if (matches) selected.add(row.id);
  }
  return selected;
}