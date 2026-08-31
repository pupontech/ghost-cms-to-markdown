import type { WorkerRequest, WorkerResponse } from './worker-protocol';
import { handleWorkerMessage } from './worker-handler';

type WorkerScope = {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  close(): void;
};

// This file is the Web Worker entry (spawned via `new Worker(...)`), so its
// top-level side effects only ever run inside the worker's own global scope.

const scope = globalThis as unknown as WorkerScope;

/** Signal that the worker is alive and its (pure) converter is ready. */
scope.postMessage({ kind: 'ready' });

scope.onmessage = (event) => {
  const message = event.data;
  if (message.kind === 'terminate') {
    scope.close();
    return;
  }
  handleWorkerMessage(message, (response) => scope.postMessage(response));
};