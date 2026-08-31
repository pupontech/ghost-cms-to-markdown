import type { WorkerLike } from '../../src/worker-host';
import { handleWorkerMessage } from '../../src/worker-handler';
import type { WorkerRequest, WorkerResponse } from '../../src/worker-protocol';

export interface FakeWorker extends WorkerLike {
  terminated: boolean;
}

/**
 * A test-only stand-in for the real Web Worker. It routes every posted message
 * through the *actual* {@link handleWorkerMessage} conversion logic, so tests
 * exercise the real worker protocol and conversion without a browser. Set
 * `failOnPost` to emulate a worker that errors at runtime.
 */
export function createFakeWorker(failOnPost = false): FakeWorker {
  const worker: FakeWorker = {
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      if (worker.terminated) return;
      if (failOnPost) {
        worker.onerror?.({ message: 'simulated worker error' });
        return;
      }
      queueMicrotask(() => {
        handleWorkerMessage(message as WorkerRequest, (response: WorkerResponse) => {
          if (!worker.terminated) worker.onmessage?.({ data: response });
        });
      });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}