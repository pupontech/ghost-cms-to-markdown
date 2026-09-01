import type { WorkerRequest, WorkerResponse, WorkerConvertResult } from './worker-protocol';
import { parseGhostExportText } from './parser';
import { convertEntryHtml } from './convert-entry';

/**
 * Pure handler for a typed worker message. Extracted so tests can drive the
 * exact worker conversion and import logic (including XSS stripping) without
 * a browser. The worker entry wires it to the real `DedicatedWorkerGlobalScope`.
 */
export function handleWorkerMessage(
  message: WorkerRequest,
  post: (message: WorkerResponse) => void,
): void {
  if (message.kind === 'parseExport') {
    post({
      kind: 'parseResult',
      requestId: message.requestId,
      outcome: parseGhostExportText(message.text),
    });
    return;
  }

  if (message.kind !== 'convertBatch') return;

  const results: WorkerConvertResult[] = message.items.map((item) => ({
    entryId: item.entryId,
    conversion: convertEntryHtml(item.html),
  }));
  post({ kind: 'batchResult', requestId: message.requestId, results });
}