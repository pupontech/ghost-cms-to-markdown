/**
 * The subset of the UI state that must be cleared whenever a new Ghost JSON
 * export is accepted, so a previous run's output can never remain downloadable
 * or be paired with the new entries' ids.
 */
export interface ResettableOutputState {
  selectedIds: Set<string>;
  documents: Map<string, unknown>;
  successIds: string[];
  searchTerm: string;
  converting: boolean;
}

/**
 * Resets selection, conversion output, search, and busy flags for a fresh
 * export. The caller is responsible for clearing DOM-only surfaces (results
 * list, preview, progress, download button) that mirror this state.
 */
export function resetOutputState(state: ResettableOutputState): void {
  state.selectedIds.clear();
  state.documents.clear();
  state.successIds = [];
  state.searchTerm = '';
  state.converting = false;
}

/** Convenience factory for tests and fresh-state bootstrap. */
export function createOutputState(): ResettableOutputState {
  return {
    selectedIds: new Set(),
    documents: new Map(),
    successIds: [],
    searchTerm: '',
    converting: false,
  };
}