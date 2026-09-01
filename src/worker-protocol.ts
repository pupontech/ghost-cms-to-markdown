import type { EntryConversion } from './convert-entry';
import type { ImportOutcome } from './parser';

/**
 * A single unit of conversion work sent from the main thread to the worker.
 * Carries only the raw HTML (already extracted from the parsed entry) so the
 * worker stays small and pure.
 */
export interface WorkerConvertItem {
  entryId: string;
  html: string | null;
}

/** One per-item conversion result returned from the worker. */
export interface WorkerConvertResult {
  entryId: string;
  conversion: EntryConversion;
}

/** Typed requests: main thread -> worker. */
export type WorkerRequest =
  | { kind: 'parseExport'; requestId: number; text: string }
  | { kind: 'convertBatch'; requestId: number; items: WorkerConvertItem[] }
  | { kind: 'terminate' };

/** Typed responses: worker -> main thread. */
export type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'parseResult'; requestId: number; outcome: ImportOutcome }
  | { kind: 'batchResult'; requestId: number; results: WorkerConvertResult[] };